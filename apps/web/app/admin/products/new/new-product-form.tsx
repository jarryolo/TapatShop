"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";

export function NewProductForm({ categories }: { categories: { id: string; name: string }[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [fields, setFields] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setFields({});

    const form = new FormData(event.currentTarget);
    const categoryId = String(form.get("categoryId") ?? "");

    const response = await fetch("/api/v1/admin/products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.get("name"),
        brand: form.get("brand") || null,
        description: form.get("description") || null,
        categoryId: categoryId || null,
      }),
    });

    setPending(false);

    if (!response.ok) {
      const body = await response.json();
      setFields(body.error?.details?.fields ?? {});
      toast(body.error?.message ?? "Could not create the product.", "error");
      return;
    }

    const { data } = await response.json();
    router.push(`/admin/products/${data.id}`);
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <Field id="name" label="Name" required error={fields.name}>
        <Input id="name" name="name" required error={fields.name} />
      </Field>

      <Field id="brand" label="Brand" error={fields.brand}>
        <Input id="brand" name="brand" error={fields.brand} />
      </Field>

      <Field id="categoryId" label="Category">
        <Select id="categoryId" name="categoryId" defaultValue="">
          <option value="">Uncategorised</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </Select>
      </Field>

      <Field
        id="description"
        label="Description"
        hint="Required before the product can be published."
        error={fields.description}
      >
        <Textarea
          id="description"
          name="description"
          rows={5}
          hint="Required before the product can be published."
          error={fields.description}
        />
      </Field>

      <Button type="submit" loading={pending}>
        Create draft
      </Button>
    </form>
  );
}
