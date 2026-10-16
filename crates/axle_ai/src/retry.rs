use reqwest::{Response, StatusCode};
use std::future::Future;
use std::time::Duration;

pub const MAX_RETRIES: u32 = 2;
const INITIAL_BACKOFF: Duration = Duration::from_secs(1);
const MAX_BACKOFF: Duration = Duration::from_secs(30);

pub fn is_retryable_status(status: StatusCode) -> bool {
    status == StatusCode::TOO_MANY_REQUESTS || status.is_server_error()
}

pub fn retry_delay(retry_index: u32) -> Duration {
    backoff_for(retry_index, INITIAL_BACKOFF)
}

pub async fn send_with_retry<F, Fut>(provider: &str, mut send: F) -> reqwest::Result<Response>
where
    F: FnMut() -> Fut,
    Fut: Future<Output = reqwest::Result<Response>>,
{
    send_with_retry_backoff(provider, INITIAL_BACKOFF, &mut send).await
}

/// [`send_with_retry`] with an injectable initial backoff so tests do not
/// sleep for real seconds.
pub async fn send_with_retry_backoff<F, Fut>(
    provider: &str,
    initial_backoff: Duration,
    send: &mut F,
) -> reqwest::Result<Response>
where
    F: FnMut() -> Fut,
    Fut: Future<Output = reqwest::Result<Response>>,
{
    let mut retries = 0;

    loop {
        match send().await {
            Ok(response) => {
                let status = response.status();
                if !is_retryable_status(status) || retries >= MAX_RETRIES {
                    return Ok(response);
                }
                let delay = backoff_for(retries, initial_backoff);
                retries += 1;
                tracing::warn!(
                    provider,
                    status = status.as_u16(),
                    retry_attempt = retries,
                    max_retries = MAX_RETRIES,
                    delay_ms = delay.as_millis() as u64,
                    "Retrying provider request after transient HTTP response"
                );
                tokio::time::sleep(delay).await;
            }
            // Connection failures, timeouts, and DNS trouble never reached the
            // provider, so replaying the request is safe. A request that the
            // client itself could not build will fail identically on retry.
            Err(error) => {
                if retries >= MAX_RETRIES || error.is_builder() {
                    return Err(error);
                }
                let delay = backoff_for(retries, initial_backoff);
                retries += 1;
                tracing::warn!(
                    provider,
                    retry_attempt = retries,
                    max_retries = MAX_RETRIES,
                    delay_ms = delay.as_millis() as u64,
                    error = %error,
                    "Retrying provider request after transport error"
                );
                tokio::time::sleep(delay).await;
            }
        }
    }
}

fn backoff_for(retry_index: u32, initial: Duration) -> Duration {
    initial
        .checked_mul(2_u32.saturating_pow(retry_index))
        .unwrap_or(MAX_BACKOFF)
        .min(MAX_BACKOFF)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn retries_only_rate_limits_and_server_errors() {
        assert!(is_retryable_status(StatusCode::TOO_MANY_REQUESTS));
        assert!(is_retryable_status(StatusCode::INTERNAL_SERVER_ERROR));
        assert!(is_retryable_status(StatusCode::SERVICE_UNAVAILABLE));
        assert!(!is_retryable_status(StatusCode::BAD_REQUEST));
        assert!(!is_retryable_status(StatusCode::UNAUTHORIZED));
        assert!(!is_retryable_status(StatusCode::OK));
    }

    #[test]
    fn exponential_backoff_is_capped_at_thirty_seconds() {
        assert_eq!(retry_delay(0), Duration::from_secs(1));
        assert_eq!(retry_delay(1), Duration::from_secs(2));
        assert_eq!(retry_delay(2), Duration::from_secs(4));
        assert_eq!(retry_delay(5), Duration::from_secs(30));
        assert_eq!(retry_delay(31), Duration::from_secs(30));
    }

    #[tokio::test]
    async fn transport_errors_are_retried_before_giving_up() {
        let attempts = std::sync::Arc::new(std::sync::atomic::AtomicU32::new(0));
        let counted = attempts.clone();
        // Port 9 on the loopback interface refuses instantly, which yields a
        // real transport error without touching the network.
        let result = send_with_retry_backoff(
            "test",
            Duration::from_millis(1),
            &mut move || {
                counted.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                async {
                    Err(reqwest::Client::new()
                        .get("http://127.0.0.1:9/")
                        .send()
                        .await
                        .unwrap_err())
                }
            },
        )
        .await;

        assert!(result.is_err());
        assert_eq!(
            attempts.load(std::sync::atomic::Ordering::SeqCst),
            MAX_RETRIES + 1
        );
    }
}
