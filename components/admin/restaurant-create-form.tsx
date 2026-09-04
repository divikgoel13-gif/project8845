"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { createRestaurant } from "@/lib/actions/admin/restaurants";
import { Card } from "@/components/ui/card";
import { SectionHeading } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea, FormError } from "@/components/ui/field";

/**
 * New-restaurant form (SRS §6, §29.1).
 *
 * Client component for one reason: §29.1 requires the University Place Name field
 * to appear only when the classification is Inside University, and requires it to
 * be filled in when it does. Doing that server-side would mean a round trip to
 * reveal a text input.
 *
 * The slug is prefilled from the name but stays editable, and stops being
 * auto-derived the moment the operator types in it. Silently overwriting a
 * hand-chosen slug on the next keystroke of the name is worse than a slug that
 * needs one correction, because the slug is the customer-facing URL and a
 * surprise change is invisible until a link breaks.
 */

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export function RestaurantCreateForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [locationType, setLocationType] = useState<"inside_university" | "outside_university">(
    "outside_university"
  );
  const [universityPlaceName, setUniversityPlaceName] = useState("");
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");

  const effectiveSlug = slugTouched ? slug : slugify(name);

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (locationType === "inside_university" && !universityPlaceName.trim()) {
      setError("A university place name is required for an inside-university restaurant.");
      return;
    }

    startTransition(async () => {
      const result = await createRestaurant(
        locationType === "inside_university"
          ? {
              name,
              slug: effectiveSlug,
              location: location || undefined,
              description: description || undefined,
              locationType: "inside_university",
              universityPlaceName: universityPlaceName.trim(),
            }
          : {
              name,
              slug: effectiveSlug,
              location: location || undefined,
              description: description || undefined,
              locationType: "outside_university",
            }
      );

      if (!result.ok) {
        setError(result.error);
        return;
      }
      // Straight into the new workspace: creating a restaurant is always
      // followed by adding hours, categories and products.
      router.push(`/admin/restaurants/${result.restaurantId}/dashboard`);
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Card>
        <SectionHeading title="Identity" description="The slug is the customer-facing URL segment and must be unique." />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Name" htmlFor="name" required>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
              required
              placeholder="Cafe 24"
            />
          </Field>

          <Field
            label="Slug"
            htmlFor="slug"
            required
            hint="Lowercase letters, numbers and single hyphens."
          >
            <Input
              id="slug"
              value={effectiveSlug}
              onChange={(e) => {
                setSlugTouched(true);
                setSlug(e.target.value);
              }}
              pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
              maxLength={60}
              required
              placeholder="cafe-24"
            />
          </Field>

          <Field label="Location" htmlFor="location" hint="Where a customer walks to. Shown on the storefront.">
            <Input
              id="location"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              maxLength={200}
              placeholder="Block C, ground floor"
            />
          </Field>

          <Field label="Description" htmlFor="description" className="sm:col-span-2">
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={1000}
              rows={3}
            />
          </Field>
        </div>
      </Card>

      <Card>
        <SectionHeading
          title="Classification"
          description="Required. Decides whether customers see the physical access warning before ordering (SRS §29.1, §29.2)."
        />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Location type" htmlFor="locationType" required>
            <Select
              id="locationType"
              value={locationType}
              onChange={(e) =>
                setLocationType(e.target.value as "inside_university" | "outside_university")
              }
            >
              <option value="outside_university">Outside university</option>
              <option value="inside_university">Inside university</option>
            </Select>
          </Field>

          {locationType === "inside_university" ? (
            <Field
              label="University place name"
              htmlFor="universityPlaceName"
              required
              hint="Named in the customer warning, so write it as customers would say it."
            >
              <Input
                id="universityPlaceName"
                value={universityPlaceName}
                onChange={(e) => setUniversityPlaceName(e.target.value)}
                maxLength={160}
                required
                placeholder="Chitkara University"
              />
            </Field>
          ) : null}
        </div>

        {locationType === "inside_university" && universityPlaceName.trim() ? (
          <p className="mt-3 rounded-brand bg-info-bg px-3 py-2 text-xs text-info">
            Customers will see: “You can only order from {universityPlaceName.trim()} if you are a valid
            student/faculty/staff member who can enter the university.”
          </p>
        ) : null}
      </Card>

      <Card>
        <SectionHeading
          title="Operational defaults"
          description="Preparation time, grace period, slot interval and slot capacity are copied from platform settings at creation and are editable per restaurant afterwards. A later change to the platform defaults will not re-time this restaurant."
        />
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={pending}>
            {pending ? "Creating…" : "Create restaurant"}
          </Button>
          <FormError>{error}</FormError>
        </div>
      </Card>
    </form>
  );
}
