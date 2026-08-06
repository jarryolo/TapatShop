"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";

/**
 * Approve or reject, with a note that goes into the audit log.
 *
 * Approving sends a confirmation link to the address the requester gave. It does not change
 * anything about the account yet, and it never touches the password — so the worst outcome
 * of a wrong approval is an email to the wrong person, not a stolen account.
 */
export function ReviewActions({
  requestId,
  matchCount,
  hasUser,
}: {
  requestId: string;
  matchCount: number;
  hasUser: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [note, setNote] = useState("");
  const [pending, setPending] = useState<"approve" | "reject" | null>(null);

  async function decide(decision: "approve" | "reject") {
    if (!note.trim()) {
      toast("Write what you checked. The note goes into the audit log.", "error");
      return;
    }

    if (decision === "approve" && matchCount < 2) {
      const proceed = window.confirm(
        `Only ${matchCount} of the claims match. docs/07 asks for at least two before approving. Approve anyway?`
      );
      if (!proceed) return;
    }

    setPending(decision);
    const response = await fetch(`/api/v1/admin/recovery/${requestId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: decision, note: note.trim() }),
    });
    setPending(null);

    const body = await response.json();
    if (!response.ok) {
      toast(body.error?.message ?? "Could not record that decision.", "error");
      return;
    }

    toast(
      decision === "approve"
        ? "Approved. A confirmation link has been sent to the new address."
        : "Rejected.",
      "success"
    );
    router.refresh();
  }

  return (
    <div className="mt-4 flex flex-col gap-4">
      <Field
        id="note"
        label="What did you check?"
        hint="Recorded in the audit log against your name."
        required
      >
        <Textarea
          id="note"
          rows={3}
          maxLength={500}
          value={note}
          placeholder="Called the chapter secretary; member number and last order both match."
          onChange={(event) => setNote(event.target.value)}
        />
      </Field>

      <div className="flex flex-wrap gap-2">
        <Button
          loading={pending === "approve"}
          disabled={!hasUser || pending !== null}
          onClick={() => decide("approve")}
        >
          Approve and send link
        </Button>
        <Button
          variant="danger"
          loading={pending === "reject"}
          disabled={pending !== null}
          onClick={() => decide("reject")}
        >
          Reject
        </Button>
      </div>

      {!hasUser ? (
        <p className="text-[13px] text-text-muted">
          Nothing in this claim matched an account, so there is nothing to approve. Reject it.
        </p>
      ) : null}
    </div>
  );
}
