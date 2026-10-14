import type { ApprovalRequestId } from "@axle/contracts";
import { Pressable, View } from "react-native";

import { AppText as Text, AppTextInput as TextInput } from "../../components/AppText";
import { cn } from "../../lib/cn";
import type { PendingUserInput, PendingUserInputDraftAnswer } from "../../lib/threadActivity";

export interface PendingUserInputCardProps {
  readonly pendingUserInput: PendingUserInput;
  readonly drafts: Record<string, PendingUserInputDraftAnswer>;
  readonly answers: Record<string, string> | null;
  readonly respondingUserInputId: ApprovalRequestId | null;
  readonly onSelectOption: (
    requestId: ApprovalRequestId,
    questionId: string,
    label: string,
  ) => void;
  readonly onChangeCustomAnswer: (
    requestId: ApprovalRequestId,
    questionId: string,
    customAnswer: string,
  ) => void;
  readonly onSubmit: () => Promise<unknown>;
}

export function PendingUserInputCard(props: PendingUserInputCardProps) {
  return (
    <View className="gap-2.5 rounded-xl border border-border bg-card p-4">
      <Text className="font-t3-bold text-2xs uppercase tracking-[1.1px] text-info-foreground">
        User input needed
      </Text>
      <Text className="font-t3-bold text-lg text-foreground">Fill in the pending answers</Text>
      {props.pendingUserInput.questions.map((question) => {
        const draft = props.drafts[question.id];
        return (
          <View key={question.id} className="gap-2 pt-1">
            <Text className="font-t3-bold text-xs uppercase tracking-[1px] text-foreground-muted">
              {question.header}
            </Text>
            <Text className="font-sans text-base leading-snug text-foreground">
              {question.question}
            </Text>
            <View className="flex-row flex-wrap gap-2.5">
              {question.options.map((option) => {
                const selected =
                  draft?.selectedOptionLabel === option.label && !draft.customAnswer?.trim().length;
                return (
                  <Pressable
                    key={option.label}
                    className={cn(
                      "rounded-lg border px-3 py-2.5 active:bg-subtle ",
                      selected ? "border-primary bg-subtle" : "border-border bg-transparent",
                    )}
                    onPress={() =>
                      props.onSelectOption(
                        props.pendingUserInput.requestId,
                        question.id,
                        option.label,
                      )
                    }
                  >
                    <Text
                      className={cn(
                        "font-t3-bold text-sm",
                        selected ? "text-foreground" : "text-foreground-muted",
                      )}
                    >
                      {option.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <TextInput
              value={draft?.customAnswer ?? ""}
              onChangeText={(value) =>
                props.onChangeCustomAnswer(props.pendingUserInput.requestId, question.id, value)
              }
              placeholder="Or type a custom answer"
              className="min-h-[54px] rounded-lg border border-input-border bg-input px-3.5 py-3 font-sans text-base text-foreground"
            />
          </View>
        );
      })}
      <Pressable
        className={cn(
          "items-center justify-center rounded-lg px-4 py-3.5 active:opacity-80 disabled:opacity-40",
          props.answers ? "bg-primary" : "bg-subtle-strong",
        )}
        disabled={
          props.answers === null || props.respondingUserInputId === props.pendingUserInput.requestId
        }
        onPress={() => void props.onSubmit()}
      >
        <Text className="font-t3-bold text-sm text-primary-foreground">Submit answers</Text>
      </Pressable>
    </View>
  );
}
