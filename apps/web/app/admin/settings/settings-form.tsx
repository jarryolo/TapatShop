"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";

export interface SettingRow {
  key: string;
  label: string;
  hint?: string;
  kind: "string" | "int" | "boolean";
  group: string;
  secret: boolean;
  value: string | number | boolean | null;
  isSet: boolean;
}

/**
 * One setting, saved on its own.
 *
 * Per-field rather than one big form on purpose: a single Save that writes ten settings at
 * once turns one intended change into ten audit rows, and makes "who changed the member
 * discount" unanswerable without reading the payload of every one.
 */
export function SettingField({ setting }: { setting: SettingRow }) {
  const router = useRouter();
  const { toast } = useToast();
  const [value, setValue] = useState<string | number | boolean>(
    setting.secret ? "" : (setting.value ?? (setting.kind === "boolean" ? false : ""))
  );
  const [pending, setPending] = useState(false);
  const [dirty, setDirty] = useState(false);

  async function save(next: string | number | boolean) {
    setPending(true);

    const response = await fetch(`/api/v1/admin/settings/${setting.key}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: next }),
    });
    setPending(false);

    const body = await response.json();
    if (!response.ok) {
      toast(body.error?.message ?? "Could not save that setting.", "error");
      return;
    }

    setDirty(false);
    // Never echo a secret back into the field, even the one just typed.
    if (setting.secret) setValue("");
    toast(`${setting.label} saved.`, "success");
    router.refresh();
  }

  if (setting.kind === "boolean") {
    return (
      <div className="flex items-start justify-between gap-4 py-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold">{setting.label}</p>
          {setting.hint ? <p className="text-[13px] text-text-muted">{setting.hint}</p> : null}
        </div>
        <label className="flex shrink-0 items-center gap-2 text-sm">
          <input
            type="checkbox"
            disabled={pending}
            checked={value === true}
            onChange={(event) => {
              setValue(event.target.checked);
              void save(event.target.checked);
            }}
          />
          <span className="sr-only">{setting.label}</span>
          {value === true ? "On" : "Off"}
        </label>
      </div>
    );
  }

  return (
    <div className="py-3">
      <Field
        id={setting.key}
        label={setting.label}
        hint={setting.hint}
        className="[&_label]:flex [&_label]:items-center [&_label]:gap-2"
      >
        <div className="flex flex-wrap items-center gap-2">
          <Input
            id={setting.key}
            className="min-w-0 flex-1"
            type={setting.kind === "int" ? "number" : setting.secret ? "password" : "text"}
            autoComplete={setting.secret ? "new-password" : "off"}
            placeholder={setting.secret && setting.isSet ? "Set. Type to replace." : undefined}
            value={String(value ?? "")}
            onChange={(event) => {
              setDirty(true);
              setValue(setting.kind === "int" ? Number(event.target.value) : event.target.value);
            }}
          />
          <Button
            size="sm"
            variant="secondary"
            loading={pending}
            disabled={!dirty}
            onClick={() => save(value)}
          >
            Save
          </Button>
          {setting.secret ? (
            <Badge tone={setting.isSet ? "success" : "warning"}>
              {setting.isSet ? "Set" : "Not set"}
            </Badge>
          ) : null}
        </div>
      </Field>
    </div>
  );
}
