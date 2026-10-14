import { StackActions, useFocusEffect, useNavigation } from "@react-navigation/native";
import type { CloudJob, CloudJobEvent } from "@axle/contracts";
import { CloudJobCreateInput } from "@axle/contracts";
import type { CloudJobsClient } from "@axle/client-runtime/cloud/jobs";
import * as Schema from "effect/Schema";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AndroidScreenHeader } from "../../components/AndroidScreenHeader";
import { AppText as Text, AppTextInput } from "../../components/AppText";
import { EmptyState } from "../../components/EmptyState";
import { ErrorBanner } from "../../components/ErrorBanner";
import { StatusPill } from "../../components/StatusPill";
import { cn } from "../../lib/cn";
import { relativeTime } from "../../lib/time";
import { uuidv4 } from "../../lib/uuid";
import { useAccountAuth } from "./AccountAuthProvider";
import {
  cloudJobStateTone,
  cloudJobSummaryLine,
  isCloudJobActive,
} from "./cloudJobPresentation";
import {
  describeCloudJobsError,
  resolveAccountApiUrl,
  useCloudJobsClient,
} from "./cloudJobsClient";

const POLL_INTERVAL_MS = 5_000;
const EVENT_STREAM_LIMIT = 500;
const EVENT_RENDER_LIMIT = 60;

const decodeCreateInput = Schema.decodeUnknownSync(CloudJobCreateInput);

/**
 * Cloud jobs live entirely on Axle Cloud: the worker keeps executing while
 * this device is offline, asleep, or closed. This screen is a monitor and a
 * control surface for the account API, never an execution host.
 */
export function CloudJobsRouteScreen() {
  const navigation = useNavigation();

  useEffect(() => {
    if (resolveAccountApiUrl() !== null) return;
    // Deep-linkable route: without an account API there is nothing to show.
    if (navigation.canGoBack()) {
      navigation.goBack();
    } else {
      navigation.dispatch(StackActions.replace("Home"));
    }
  }, [navigation]);

  return resolveAccountApiUrl() !== null ? <ConfiguredCloudJobsRouteScreen /> : null;
}

function ConfiguredCloudJobsRouteScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { isLoaded, isSignedIn } = useAccountAuth();
  const client = useCloudJobsClient();

  return (
    <View collapsable={false} className="flex-1 bg-sheet">
      {Platform.OS === "android" ? (
        <AndroidScreenHeader title="Cloud Jobs" onBack={() => navigation.goBack()} />
      ) : null}
      {!isLoaded ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator />
        </View>
      ) : !isSignedIn ? (
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={{ padding: 20 }}
        >
          <EmptyState
            title="Sign in to Axle Cloud"
            detail="Cloud jobs run on Axle's own workers, so work keeps going even when this device is offline. Sign in to create and monitor them."
            actionLabel="Sign in"
            onAction={() => navigation.navigate("SettingsSheet", { screen: "SettingsAuth" })}
            variant="card"
          />
        </ScrollView>
      ) : client === null ? (
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={{ padding: 20 }}
        >
          <EmptyState
            title="Cloud jobs unavailable"
            detail="This build was compiled without an account API URL, so it cannot reach Axle Cloud."
            variant="card"
          />
        </ScrollView>
      ) : (
        <CloudJobsBody bottomInset={insets.bottom} client={client} />
      )}
    </View>
  );
}
function CloudJobsBody(props: {
  readonly bottomInset: number;
  readonly client: CloudJobsClient;
}) {
  const { client } = props;
  const [jobs, setJobs] = useState<ReadonlyArray<CloudJob> | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [selectedJob, setSelectedJob] = useState<CloudJob | null>(null);
  const [events, setEvents] = useState<ReadonlyArray<CloudJobEvent>>([]);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [inputDraft, setInputDraft] = useState("");
  const [createOpen, setCreateOpen] = useState(false);

  const selectedJobIdRef = useRef<string | null>(null);
  const eventsCursorRef = useRef(0);
  const responseCommandIdsRef = useRef(new Map<string, string>());

  useEffect(() => {
    selectedJobIdRef.current = selectedJobId;
  }, [selectedJobId]);

  // One stable command id per logical user action: a retried tap reuses the
  // id so the account API can deduplicate instead of double-applying it.
  const commandIdFor = useCallback((prefix: string, key: string) => {
    const store = responseCommandIdsRef.current;
    const existing = store.get(key);
    if (existing !== undefined) return existing;
    const next = prefix + "-" + uuidv4();
    store.set(key, next);
    return next;
  }, []);

  const refreshJobs = useCallback(async () => {
    try {
      const next = await client.listJobs();
      setJobs(next);
      setListError(null);
    } catch (error) {
      setListError(describeCloudJobsError(error));
    }
  }, [client]);

  const loadSelection = useCallback(
    async (jobId: string) => {
      try {
        const job = await client.getJob(jobId);
        setSelectedJob(job);
        setDetailError(null);
        const page = await client.listEvents(jobId, {
          after: eventsCursorRef.current,
          limit: 200,
        });
        if (page.events.length > 0) {
          setEvents((prev) => {
            const next = [...prev, ...page.events];
            return next.length > EVENT_STREAM_LIMIT
              ? next.slice(next.length - EVENT_STREAM_LIMIT)
              : next;
          });
        }
        eventsCursorRef.current = page.lastSequence;
      } catch (error) {
        setDetailError(describeCloudJobsError(error));
      }
    },
    [client],
  );

  const handleSelect = useCallback(
    (job: CloudJob) => {
      setSelectedJobId(job.jobId);
      setSelectedJob(job);
      setActionError(null);
      setActionBusy(null);
      setDetailError(null);
      setInputDraft("");
      eventsCursorRef.current = 0;
      setEvents([]);
      void loadSelection(job.jobId);
    },
    [loadSelection],
  );

  // Poll while the screen is focused. Refreshing the list never interferes
  // with the selected job; the detail panel keeps its own cursor so
  // reconnects resume the event stream instead of replaying it.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      const tick = async () => {
        if (cancelled) return;
        await refreshJobs();
        const jobId = selectedJobIdRef.current;
        if (jobId !== null && !cancelled) {
          await loadSelection(jobId);
        }
      };
      void tick();
      const interval = setInterval(() => {
        void tick();
      }, POLL_INTERVAL_MS);
      return () => {
        cancelled = true;
        clearInterval(interval);
      };
    }, [loadSelection, refreshJobs]),
  );

  const handlePullRefresh = useCallback(() => {
    void (async () => {
      setRefreshing(true);
      await refreshJobs();
      const jobId = selectedJobIdRef.current;
      if (jobId !== null) {
        await loadSelection(jobId);
      }
      setRefreshing(false);
    })();
  }, [loadSelection, refreshJobs]);

  const decide = useCallback(
    (decision: "allow" | "deny") => {
      const job = selectedJob;
      const request = job?.pendingRequest;
      if (!job || !request || request.kind !== "approval") return;
      const key = request.requestId + ":" + decision;
      void (async () => {
        setActionBusy(decision);
        setActionError(null);
        try {
          const updated = await client.respondToRequest(job.jobId, {
            commandId: commandIdFor("respond", key),
            requestId: request.requestId,
            payload: { decision },
          });
          responseCommandIdsRef.current.delete(key);
          setSelectedJob(updated);
          await loadSelection(job.jobId);
        } catch (error) {
          setActionError(describeCloudJobsError(error));
        } finally {
          setActionBusy(null);
        }
      })();
    },
    [client, commandIdFor, loadSelection, selectedJob],
  );

  const sendInput = useCallback(() => {
    const job = selectedJob;
    const request = job?.pendingRequest;
    const text = inputDraft.trim();
    if (!job || !request || request.kind !== "input" || text.length === 0) return;
    const key = request.requestId + ":input:" + text;
    void (async () => {
      setActionBusy("input");
      setActionError(null);
      try {
        const updated = await client.respondToRequest(job.jobId, {
          commandId: commandIdFor("respond", key),
          requestId: request.requestId,
          payload: text,
        });
        responseCommandIdsRef.current.delete(key);
        setSelectedJob(updated);
        setInputDraft("");
        await loadSelection(job.jobId);
      } catch (error) {
        setActionError(describeCloudJobsError(error));
      } finally {
        setActionBusy(null);
      }
    })();
  }, [client, commandIdFor, inputDraft, loadSelection, selectedJob]);

  const cancelJob = useCallback(() => {
    const job = selectedJob;
    if (!job) return;
    void (async () => {
      setActionBusy("cancel");
      setActionError(null);
      try {
        const updated = await client.cancelJob(job.jobId);
        setSelectedJob(updated);
        await loadSelection(job.jobId);
      } catch (error) {
        setActionError(describeCloudJobsError(error));
      } finally {
        setActionBusy(null);
      }
    })();
  }, [client, loadSelection, selectedJob]);

  const handleCreated = useCallback(
    (job: CloudJob) => {
      setCreateOpen(false);
      setJobs((prev) => [job, ...(prev ?? []).filter((entry) => entry.jobId !== job.jobId)]);
      handleSelect(job);
    },
    [handleSelect],
  );

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      keyboardDismissMode="interactive"
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl onRefresh={handlePullRefresh} refreshing={refreshing} />}
      showsVerticalScrollIndicator={false}
      className="flex-1"
      contentContainerStyle={{
        gap: 16,
        paddingBottom: Math.max(props.bottomInset, 18) + 18,
        paddingHorizontal: 20,
        paddingTop: 16,
      }}
    >
      {createOpen ? (
        <CloudJobsCreateForm
          client={client}
          onCancel={() => setCreateOpen(false)}
          onCreated={handleCreated}
        />
      ) : (
        <Pressable
          accessibilityRole="button"
          className="items-center rounded-xl bg-primary px-4 py-3 active:opacity-80"
          onPress={() => setCreateOpen(true)}
        >
          <Text className="text-sm font-t3-bold text-primary-foreground">New cloud job</Text>
        </Pressable>
      )}

      {listError ? <ErrorBanner message={listError} /> : null}

      <Text className="px-1 text-xs font-t3-bold text-foreground-muted uppercase tracking-wide">
        Axle Cloud · runs without this device
      </Text>

      {jobs === null ? (
        <View className="items-center rounded-2xl bg-card px-6 py-8">
          <ActivityIndicator />
        </View>
      ) : jobs.length === 0 ? (
        <EmptyState
          title="No cloud jobs yet"
          detail="Create a job to run a task on Axle Cloud. It keeps running when this device is closed."
          actionLabel="Create a cloud job"
          onAction={() => setCreateOpen(true)}
          variant="card"
        />
      ) : (
        <View collapsable={false} className="overflow-hidden rounded-2xl bg-card">
          {jobs.map((job, index) => (
            <View
              key={job.jobId}
              collapsable={false}
              className={cn(index !== 0 && "border-t border-border")}
            >
              <CloudJobRow
                job={job}
                onPress={() => handleSelect(job)}
                selected={job.jobId === selectedJobId}
              />
            </View>
          ))}
        </View>
      )}

      {selectedJob !== null ? (
        <CloudJobDetail
          actionBusy={actionBusy}
          actionError={actionError}
          detailError={detailError}
          events={events}
          inputDraft={inputDraft}
          job={selectedJob}
          onCancel={cancelJob}
          onChangeInput={setInputDraft}
          onDecide={decide}
          onSendInput={sendInput}
        />
      ) : null}
    </ScrollView>
  );
}
function CloudJobRow(props: {
  readonly job: CloudJob;
  readonly selected: boolean;
  readonly onPress: () => void;
}) {
  const tone = cloudJobStateTone(props.job.state);
  return (
    <Pressable
      accessibilityRole="button"
      className={cn("gap-1.5 p-4 active:bg-subtle", props.selected && "bg-subtle")}
      onPress={props.onPress}
    >
      <View className="flex-row items-center justify-between gap-3">
        <Text className="flex-1 text-base font-t3-bold text-foreground" numberOfLines={2}>
          {props.job.input.prompt}
        </Text>
        <StatusPill size="compact" {...tone} />
      </View>
      <Text className="text-xs text-foreground-muted" numberOfLines={1}>
        {cloudJobSummaryLine(props.job.state) + " · " + props.job.input.environmentId + " · " +
          relativeTime(props.job.updatedAt)}
      </Text>
    </Pressable>
  );
}

function CloudJobDetail(props: {
  readonly actionBusy: string | null;
  readonly actionError: string | null;
  readonly detailError: string | null;
  readonly events: ReadonlyArray<CloudJobEvent>;
  readonly inputDraft: string;
  readonly job: CloudJob;
  readonly onCancel: () => void;
  readonly onChangeInput: (value: string) => void;
  readonly onDecide: (decision: "allow" | "deny") => void;
  readonly onSendInput: () => void;
}) {
  const tone = cloudJobStateTone(props.job.state);
  const request = props.job.pendingRequest;
  const result = props.job.result;
  const busy = props.actionBusy !== null;

  return (
    <View className="gap-3">
      <View className="gap-3 rounded-2xl bg-card p-4">
        <View className="flex-row items-start justify-between gap-3">
          <Text className="flex-1 text-lg font-t3-bold text-foreground">Job detail</Text>
          <StatusPill size="compact" {...tone} />
        </View>
        <Text className="text-sm text-foreground-muted">
          {cloudJobSummaryLine(props.job.state)}
        </Text>
        <View className="gap-1.5">
          <MetaRow label="Environment" value={props.job.input.environmentId} />
          <MetaRow label="Repository" value={props.job.input.repositoryUrl} />
          <MetaRow label="Revision" value={props.job.input.sourceRevision.slice(0, 12)} />
          <MetaRow
            label="Model"
            value={props.job.input.providerInstanceId + " · " + props.job.input.model}
          />
          <MetaRow label="Updated" value={relativeTime(props.job.updatedAt) + " ago"} />
        </View>
        {props.job.cancelRequestedAt !== null && isCloudJobActive(props.job.state) ? (
          <Text className="text-xs text-warning">
            Cancellation requested — waiting for the worker to stop.
          </Text>
        ) : null}
        {props.job.failureCode !== null ? (
          <Text className="text-xs text-danger-foreground">Failure: {props.job.failureCode}</Text>
        ) : null}
        {isCloudJobActive(props.job.state) ? (
          <Pressable
            accessibilityRole="button"
            className={cn(
              "items-center rounded-xl border border-danger-border px-4 py-3",
              busy && "opacity-55",
            )}
            disabled={busy}
            onPress={props.onCancel}
          >
            <Text className="text-sm font-t3-bold text-danger-foreground">
              {props.actionBusy === "cancel" ? "Cancelling…" : "Cancel job"}
            </Text>
          </Pressable>
        ) : null}
        {props.actionError ? <ErrorBanner message={props.actionError} /> : null}
        {props.detailError ? <ErrorBanner message={props.detailError} /> : null}
      </View>

      {request ? (
        <View className="gap-3 rounded-2xl border border-border bg-card p-4">
          <Text className="text-sm font-t3-bold text-warning">
            {request.kind === "approval" ? "Approval requested" : "Input requested"}
          </Text>
          <Text className="text-sm text-foreground-muted">{previewPayload(request.payload)}</Text>
          {request.kind === "approval" ? (
            <View className="flex-row gap-2">
              <Pressable
                accessibilityRole="button"
                className={cn(
                  "flex-1 items-center rounded-xl bg-primary px-4 py-3 active:opacity-80",
                  busy && "opacity-55",
                )}
                disabled={busy}
                onPress={() => props.onDecide("allow")}
              >
                <Text className="text-sm font-t3-bold text-primary-foreground">
                  {props.actionBusy === "allow" ? "Allowing…" : "Allow once"}
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                className={cn(
                  "flex-1 items-center rounded-xl bg-danger px-4 py-3 active:opacity-80",
                  busy && "opacity-55",
                )}
                disabled={busy}
                onPress={() => props.onDecide("deny")}
              >
                <Text className="text-sm font-t3-bold text-danger-foreground">
                  {props.actionBusy === "deny" ? "Denying…" : "Deny"}
                </Text>
              </Pressable>
            </View>
          ) : (
            <View className="gap-2">
              <AppTextInput
                multiline
                onChangeText={props.onChangeInput}
                placeholder="Type your response"
                value={props.inputDraft}
              />
              <Pressable
                accessibilityRole="button"
                className={cn(
                  "items-center rounded-xl bg-primary px-4 py-3 active:opacity-80",
                  (busy || props.inputDraft.trim().length === 0) && "opacity-55",
                )}
                disabled={busy || props.inputDraft.trim().length === 0}
                onPress={props.onSendInput}
              >
                <Text className="text-sm font-t3-bold text-primary-foreground">
                  {props.actionBusy === "input" ? "Sending…" : "Send response"}
                </Text>
              </Pressable>
            </View>
          )}
        </View>
      ) : null}

      {result ? (
        <View className="gap-2 rounded-2xl bg-card p-4">
          <Text className="text-sm font-t3-bold text-foreground">Results</Text>
          <Text className="text-xs text-foreground-muted">
            Changes are ready for review. Open this job on desktop or web to inspect the full diff.
          </Text>
          {result.artifacts.map((artifact) => (
            <View
              key={artifact.storageKey}
              className="flex-row items-center justify-between gap-3"
            >
              <Text className="flex-1 text-sm text-foreground" numberOfLines={1}>
                {artifact.kind + " · " + artifact.storageKey}
              </Text>
              <Text className="text-xs text-foreground-muted">
                {formatBytes(artifact.sizeBytes)}
              </Text>
            </View>
          ))}
        </View>
      ) : null}

      <View className="gap-2 rounded-2xl bg-card p-4">
        <Text className="text-sm font-t3-bold text-foreground">Activity</Text>
        {props.events.length === 0 ? (
          <Text className="text-xs text-foreground-muted">No events streamed yet.</Text>
        ) : (
          props.events
            .slice(-EVENT_RENDER_LIMIT)
            .reverse()
            .map((event) => (
              <View key={event.sequence} className="flex-row items-baseline gap-2">
                <Text className="text-xs font-t3-bold text-foreground-muted">
                  {"#" + String(event.sequence)}
                </Text>
                <Text className="text-xs text-foreground-muted">{event.kind}</Text>
                <Text className="flex-1 text-xs text-foreground" numberOfLines={2}>
                  {previewPayload(event.payload)}
                </Text>
                <Text className="text-xs text-foreground-muted">
                  {relativeTime(event.createdAt)}
                </Text>
              </View>
            ))
        )}
      </View>
    </View>
  );
}

function MetaRow(props: { readonly label: string; readonly value: string }) {
  return (
    <View className="flex-row items-baseline gap-2">
      <Text className="w-28 text-xs text-foreground-muted uppercase tracking-wide">
        {props.label}
      </Text>
      <Text className="flex-1 text-sm text-foreground" numberOfLines={1}>
        {props.value}
      </Text>
    </View>
  );
}

function previewPayload(value: unknown): string {
  try {
    const text = typeof value === "string" ? value : JSON.stringify(value);
    if (typeof text !== "string") return "";
    return text.length > 400 ? text.slice(0, 400) + "…" : text;
  } catch {
    return "";
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return String(bytes) + " B";
  const kb = bytes / 1024;
  if (kb < 1024) return kb.toFixed(1) + " KB";
  return (kb / 1024).toFixed(1) + " MB";
}
function CloudJobsCreateForm(props: {
  readonly client: CloudJobsClient;
  readonly onCancel: () => void;
  readonly onCreated: (job: CloudJob) => void;
}) {
  const { client, onCancel, onCreated } = props;
  const [environmentId, setEnvironmentId] = useState("");
  const [repositoryUrl, setRepositoryUrl] = useState("");
  const [sourceRevision, setSourceRevision] = useState("");
  const [prompt, setPrompt] = useState("");
  const [providerInstanceId, setProviderInstanceId] = useState("");
  const [model, setModel] = useState("");
  const [interactionMode, setInteractionMode] = useState<"default" | "plan">("default");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Survives a failed submit so a retry reuses the same command id and the
  // account API deduplicates instead of creating two jobs.
  const commandIdRef = useRef<string | null>(null);

  const handleSubmit = useCallback(() => {
    void (async () => {
      const fields = {
        environmentId: environmentId.trim(),
        repositoryUrl: repositoryUrl.trim(),
        sourceRevision: sourceRevision.trim().toLowerCase(),
        prompt: prompt.trim(),
        providerInstanceId: providerInstanceId.trim(),
        model: model.trim(),
      };
      const problem = validateCreateFields(fields);
      if (problem !== null) {
        setError(problem);
        return;
      }
      setSubmitting(true);
      setError(null);
      try {
        const commandId = commandIdRef.current ?? "create-" + uuidv4();
        commandIdRef.current = commandId;
        const input = decodeCreateInput({
          commandId,
          environmentId: fields.environmentId,
          repositoryUrl: fields.repositoryUrl,
          sourceRevision: fields.sourceRevision,
          prompt: fields.prompt,
          providerInstanceId: fields.providerInstanceId,
          model: fields.model,
          runtimeMode: "approval-required",
          interactionMode,
        });
        const result = await client.createJob(input);
        commandIdRef.current = null;
        onCreated(result.job);
      } catch (caught) {
        if (caught instanceof Error && caught.name === "CloudJobsApiError") {
          setError(describeCloudJobsError(caught));
        } else {
          setError("Could not create the job. Check the fields and try again.");
        }
      } finally {
        setSubmitting(false);
      }
    })();
  }, [client, environmentId, interactionMode, model, onCreated, prompt, providerInstanceId, repositoryUrl, sourceRevision]);

  return (
    <View className="gap-3 rounded-2xl bg-card p-4">
      <Text className="text-base font-t3-bold text-foreground">New cloud job</Text>
      <Text className="text-xs text-foreground-muted">
        The worker checks out this revision and runs with approval-required permissions. Safe mode
        is enforced server-side.
      </Text>
      <FormField
        label="Environment id"
        onChangeText={setEnvironmentId}
        placeholder="cloud environment"
        value={environmentId}
      />
      <FormField
        label="Repository URL"
        onChangeText={setRepositoryUrl}
        placeholder="https://github.com/owner/repo.git"
        value={repositoryUrl}
      />
      <FormField
        label="Commit SHA"
        onChangeText={setSourceRevision}
        placeholder="40- or 64-character revision"
        value={sourceRevision}
      />
      <FormField
        label="Task"
        multiline
        onChangeText={setPrompt}
        placeholder="Describe the task for the cloud agent"
        value={prompt}
      />
      <FormField
        label="Provider"
        onChangeText={setProviderInstanceId}
        placeholder="openai"
        value={providerInstanceId}
      />
      <FormField
        label="Model"
        onChangeText={setModel}
        placeholder="gpt-6-sol"
        value={model}
      />
      <View className="gap-1.5">
        <Text className="px-1 text-xs font-t3-bold text-foreground-muted uppercase tracking-wide">
          Interaction
        </Text>
        <View className="flex-row gap-2">
          <ModeButton
            active={interactionMode === "default"}
            label="Execute"
            onPress={() => setInteractionMode("default")}
          />
          <ModeButton
            active={interactionMode === "plan"}
            label="Plan first"
            onPress={() => setInteractionMode("plan")}
          />
        </View>
      </View>
      {error ? <ErrorBanner message={error} /> : null}
      <View className="flex-row gap-2">
        <Pressable
          accessibilityRole="button"
          className="flex-1 items-center rounded-xl border border-border px-4 py-3 active:opacity-80"
          disabled={submitting}
          onPress={onCancel}
        >
          <Text className="text-sm font-t3-bold text-foreground">Cancel</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          className={cn(
            "flex-1 items-center rounded-xl bg-primary px-4 py-3 active:opacity-80",
            submitting && "opacity-55",
          )}
          disabled={submitting}
          onPress={handleSubmit}
        >
          <Text className="text-sm font-t3-bold text-primary-foreground">
            {submitting ? "Starting…" : "Start job"}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

function FormField(props: {
  readonly label: string;
  readonly value: string;
  readonly onChangeText: (value: string) => void;
  readonly placeholder?: string;
  readonly multiline?: boolean;
}) {
  return (
    <View className="gap-1.5">
      <Text className="px-1 text-xs font-t3-bold text-foreground-muted uppercase tracking-wide">
        {props.label}
      </Text>
      <AppTextInput
        autoCapitalize="none"
        autoCorrect={false}
        multiline={props.multiline === true}
        onChangeText={props.onChangeText}
        placeholder={props.placeholder ?? ""}
        value={props.value}
      />
    </View>
  );
}

function ModeButton(props: {
  readonly active: boolean;
  readonly label: string;
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      className={cn(
        "flex-1 items-center rounded-xl border border-border px-3 py-2.5 active:opacity-80",
        props.active && "bg-subtle",
      )}
      onPress={props.onPress}
    >
      <Text
        className={cn(
          "text-sm",
          props.active ? "font-t3-bold text-foreground" : "text-foreground-muted",
        )}
      >
        {props.label}
      </Text>
    </Pressable>
  );
}

function validateCreateFields(fields: {
  readonly environmentId: string;
  readonly repositoryUrl: string;
  readonly sourceRevision: string;
  readonly prompt: string;
  readonly providerInstanceId: string;
  readonly model: string;
}): string | null {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(fields.environmentId)) {
    return "Enter the cloud environment id to run in.";
  }
  if (!/^https?:\/\//.test(fields.repositoryUrl) && !fields.repositoryUrl.startsWith("git@")) {
    return "Enter a repository URL (https://… or git@…).";
  }
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(fields.sourceRevision)) {
    return "Enter the full 40- or 64-character commit SHA to check out.";
  }
  if (fields.prompt.length === 0) {
    return "Describe the task for the cloud agent.";
  }
  if (fields.providerInstanceId.length === 0) {
    return "Enter a provider instance id (e.g. openai).";
  }
  if (fields.model.length === 0) {
    return "Enter a model.";
  }
  return null;
}