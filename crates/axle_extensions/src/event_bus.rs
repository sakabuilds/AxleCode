use crate::events::AxleEvent;
use std::sync::Arc;

pub type EventHandler = Arc<dyn Fn(&AxleEvent) + Send + Sync>;

#[derive(Clone, Default)]
pub struct EventBus {
    subscribers: Vec<EventHandler>,
}

impl EventBus {
    pub fn new() -> Self {
        Self {
            subscribers: Vec::new(),
        }
    }

    pub fn subscribe<F>(&mut self, handler: F)
    where
        F: Fn(&AxleEvent) + Send + Sync + 'static,
    {
        self.subscribers.push(Arc::new(handler));
    }

    pub fn emit(&self, event: &AxleEvent) {
        for subscriber in &self.subscribers {
            subscriber(event);
        }
    }
}
