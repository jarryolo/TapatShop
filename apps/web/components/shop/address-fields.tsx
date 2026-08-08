"use client";

import { useEffect, useState } from "react";

import { Field } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";

export interface AddressValue {
  region: string;
  province: string;
  city: string;
  barangay: string;
  street: string;
  postalCode: string;
}

interface Place {
  code: string;
  name: string;
}

/**
 * The PH address cascade: region → province → city/municipality → barangay.
 *
 * Each level is fetched from `/api/v1/locations` rather than bundled. The complete PSGC is
 * 42,046 barangays, and this is a client component — bundling it would ship the whole country
 * to every shopper before they can type a street name. One request per level is a few hundred
 * rows.
 *
 * **What is stored is names, not codes.** `AddressValue` is what gets frozen onto the order and
 * printed on a packing slip, and a courier cannot read `137404021`. The PSGC codes are held
 * only in local state, to ask for the next level down.
 *
 * Every level still falls back to free text when a fetch fails or returns nothing. A customer
 * must be able to complete an address even when this endpoint is having a bad day.
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
  const [regions, setRegions] = useState<(Place & { regionKey: string })[]>([]);
  const [provinces, setProvinces] = useState<Place[]>([]);
  const [cities, setCities] = useState<Place[]>([]);
  const [barangays, setBarangays] = useState<Place[]>([]);

  // The codes behind the selected names, so the next level can be asked for.
  const [provinceCode, setProvinceCode] = useState("");
  const [cityCode, setCityCode] = useState("");

  useEffect(() => {
    let cancelled = false;
    void fetchLevel("").then((rows) => {
      if (!cancelled) setRegions(rows as (Place & { regionKey: string })[]);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * NCR returns cities where every other region returns provinces, because the PSA files its
   * cities directly under the region. The endpoint says which level it answered with, so the
   * form follows rather than assuming a fixed depth.
   */
  useEffect(() => {
    if (!value.region) {
      setProvinces([]);
      setCities([]);
      return;
    }

    let cancelled = false;
    void fetchLevelWithKind(`region=${encodeURIComponent(value.region)}`).then((result) => {
      if (cancelled) return;
      if (result.level === "city") {
        setProvinces([]);
        setCities(result.data);
      } else {
        setProvinces(result.data);
        setCities([]);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [value.region]);

  useEffect(() => {
    if (!provinceCode) return;

    let cancelled = false;
    void fetchLevel(`province=${encodeURIComponent(provinceCode)}`).then((rows) => {
      if (!cancelled) setCities(rows);
    });

    return () => {
      cancelled = true;
    };
  }, [provinceCode]);

  useEffect(() => {
    if (!cityCode) {
      setBarangays([]);
      return;
    }

    let cancelled = false;
    void fetchLevel(`city=${encodeURIComponent(cityCode)}`).then((rows) => {
      if (!cancelled) setBarangays(rows);
    });

    return () => {
      cancelled = true;
    };
  }, [cityCode]);

  /** Changing a level clears the ones below it — a stale city under a new region is wrong. */
  function set(patch: Partial<AddressValue>) {
    const next = { ...value, ...patch };

    if (patch.region !== undefined) {
      next.province = "";
      next.city = "";
      next.barangay = "";
      setProvinceCode("");
      setCityCode("");
    } else if (patch.province !== undefined) {
      next.city = "";
      next.barangay = "";
      setCityCode("");
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
          {regions.map((region) => (
            // The shipping key, not the PSGC code: rates are configured against it.
            <option key={region.code} value={region.regionKey}>
              {regionLabel(region)}
            </option>
          ))}
        </Select>
      </Field>

      <Field id="province" label="Province" required error={errors.province}>
        {provinces.length > 0 ? (
          <Select
            id="province"
            value={value.province}
            error={errors.province}
            onChange={(event) => {
              const chosen = provinces.find((p) => p.name === event.target.value);
              setProvinceCode(chosen?.code ?? "");
              set({ province: event.target.value });
            }}
          >
            <option value="">Select a province</option>
            {provinces.map((province) => (
              <option key={province.code} value={province.name}>
                {province.name}
              </option>
            ))}
          </Select>
        ) : (
          <Input
            id="province"
            value={value.province}
            disabled={!value.region}
            // NCR genuinely has none, so this is the normal case there rather than an error.
            placeholder={value.region ? "Not applicable in this region" : "Pick a region first"}
            error={errors.province}
            onChange={(event) => set({ province: event.target.value })}
          />
        )}
      </Field>

      <Field id="city" label="City or municipality" required error={errors.city}>
        {cities.length > 0 ? (
          <Select
            id="city"
            value={value.city}
            error={errors.city}
            onChange={(event) => {
              const chosen = cities.find((c) => c.name === event.target.value);
              setCityCode(chosen?.code ?? "");
              set({ city: event.target.value });
            }}
          >
            <option value="">Select a city or municipality</option>
            {cities.map((city) => (
              <option key={city.code} value={city.name}>
                {city.name}
              </option>
            ))}
          </Select>
        ) : (
          <Input
            id="city"
            value={value.city}
            disabled={!value.region}
            placeholder={value.region ? "Type your city or municipality" : "Pick a region first"}
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
            onChange={(event) => set({ barangay: event.target.value })}
          >
            <option value="">Select a barangay</option>
            {barangays.map((barangay) => (
              <option key={barangay.code} value={barangay.name}>
                {barangay.name}
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
            onChange={(event) => set({ barangay: event.target.value })}
          />
        )}
      </Field>

      <Field id="street" label="House number and street" required error={errors.street}>
        <Input
          id="street"
          value={value.street}
          error={errors.street}
          onChange={(event) => set({ street: event.target.value })}
        />
      </Field>

      <Field id="postalCode" label="Postal code" error={errors.postalCode}>
        <Input
          id="postalCode"
          inputMode="numeric"
          maxLength={4}
          value={value.postalCode}
          error={errors.postalCode}
          onChange={(event) => set({ postalCode: event.target.value })}
        />
      </Field>
    </div>
  );
}

/**
 * "Central Visayas (Region VII)" — both halves, because Filipinos identify a region by either
 * and the PSA publishes only the name. A shopper looking for "Region VII" would otherwise have
 * to know it is Central Visayas. NCR, CAR and BARMM are named by their acronym already, so
 * they are not repeated.
 */
function regionLabel(region: { name: string; regionKey: string }): string {
  return region.name === region.regionKey ? region.name : `${region.name} (${region.regionKey})`;
}

async function fetchLevelWithKind(query: string): Promise<{ level: string; data: Place[] }> {
  try {
    const response = await fetch(`/api/v1/locations${query ? `?${query}` : ""}`);
    if (!response.ok) return { level: "none", data: [] };
    const body = await response.json();
    return { level: String(body.level), data: Array.isArray(body.data) ? body.data : [] };
  } catch {
    // An empty list turns the field into free text, which is the fallback that keeps a
    // customer able to finish their address when this endpoint is unavailable.
    return { level: "none", data: [] };
  }
}

async function fetchLevel(query: string): Promise<Place[]> {
  return (await fetchLevelWithKind(query)).data;
}
