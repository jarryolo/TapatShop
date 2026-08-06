"use client";

import { useEffect, useState } from "react";

import { Field } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import { type City, REGIONS, barangaysFor, citiesFor, provincesFor } from "@/lib/data/ph-locations";

export interface AddressValue {
  region: string;
  province: string;
  city: string;
  barangay: string;
  street: string;
  postalCode: string;
}

/**
 * The PH address cascade: region → province → city/municipality → barangay.
 *
 * The lists come from the bundled module rather than a fetch — it is reference data, and a
 * checkout form should not wait on four round trips to let someone type their address.
 *
 * Barangay falls back to a free text field for any city the dataset does not cover. The
 * dataset is deliberately partial (see lib/data/ph-locations.ts), and a customer in a
 * municipality we have not imported yet must still be able to buy something.
 */
export function AddressFields({
  value,
  onChange,
  errors = {},
}: {
  value: AddressValue;
  onChange: (next: AddressValue) => void;
  errors?: Partial<Record<keyof AddressValue, string>>;
}) {
  const [provinces, setProvinces] = useState<string[]>([]);
  const [cities, setCities] = useState<City[]>([]);
  const [barangays, setBarangays] = useState<string[]>([]);

  useEffect(() => {
    setProvinces(value.region ? provincesFor(value.region) : []);
  }, [value.region]);

  useEffect(() => {
    setCities(value.province ? citiesFor(value.province) : []);
  }, [value.province]);

  useEffect(() => {
    setBarangays(value.city ? barangaysFor(value.city) : []);
  }, [value.city]);

  /** Changing a level clears the ones below it — a stale city under a new region is wrong. */
  function set(patch: Partial<AddressValue>) {
    const next = { ...value, ...patch };

    if (patch.region !== undefined) {
      next.province = "";
      next.city = "";
      next.barangay = "";
    } else if (patch.province !== undefined) {
      next.city = "";
      next.barangay = "";
    } else if (patch.city !== undefined) {
      next.barangay = "";
    }

    onChange(next);
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Field id="region" label="Region" required error={errors.region}>
        <Select
          id="region"
          value={value.region}
          error={errors.region}
          onChange={(event) => set({ region: event.target.value })}
        >
          <option value="">Select a region</option>
          {REGIONS.map((region) => (
            <option key={region.code} value={region.code}>
              {region.name}
            </option>
          ))}
        </Select>
      </Field>

      <Field id="province" label="Province" required error={errors.province}>
        <Select
          id="province"
          value={value.province}
          disabled={provinces.length === 0}
          error={errors.province}
          onChange={(event) => set({ province: event.target.value })}
        >
          <option value="">{value.region ? "Select a province" : "Pick a region first"}</option>
          {provinces.map((province) => (
            <option key={province} value={province}>
              {province}
            </option>
          ))}
        </Select>
      </Field>

      <Field id="city" label="City or municipality" required error={errors.city}>
        {cities.length > 0 ? (
          <Select
            id="city"
            value={value.city}
            error={errors.city}
            onChange={(event) => set({ city: event.target.value })}
          >
            <option value="">Select a city or municipality</option>
            {cities.map((city) => (
              <option key={city.name} value={city.name}>
                {city.name}
              </option>
            ))}
          </Select>
        ) : (
          // Free text for provinces the dataset has not covered yet.
          <Input
            id="city"
            value={value.city}
            disabled={!value.province}
            placeholder={
              value.province ? "Type your city or municipality" : "Pick a province first"
            }
            error={errors.city}
            onChange={(event) => set({ city: event.target.value })}
          />
        )}
      </Field>

      <Field id="barangay" label="Barangay" required error={errors.barangay}>
        {barangays.length > 0 ? (
          <Select
            id="barangay"
            value={value.barangay}
            error={errors.barangay}
            onChange={(event) => onChange({ ...value, barangay: event.target.value })}
          >
            <option value="">Select a barangay</option>
            {barangays.map((barangay) => (
              <option key={barangay} value={barangay}>
                {barangay}
              </option>
            ))}
          </Select>
        ) : (
          <Input
            id="barangay"
            value={value.barangay}
            disabled={!value.city}
            placeholder={value.city ? "Type your barangay" : "Pick a city first"}
            error={errors.barangay}
            onChange={(event) => onChange({ ...value, barangay: event.target.value })}
          />
        )}
      </Field>

      <div className="md:col-span-2">
        <Field id="street" label="House number and street" required error={errors.street}>
          <Input
            id="street"
            value={value.street}
            error={errors.street}
            placeholder="24 Sampaguita Street, Project 4"
            onChange={(event) => onChange({ ...value, street: event.target.value })}
          />
        </Field>
      </div>

      <Field id="postalCode" label="Postal code" error={errors.postalCode}>
        <Input
          id="postalCode"
          value={value.postalCode}
          inputMode="numeric"
          placeholder="1109"
          error={errors.postalCode}
          onChange={(event) => onChange({ ...value, postalCode: event.target.value })}
        />
      </Field>
    </div>
  );
}
