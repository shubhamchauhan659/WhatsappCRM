"use client";

/**
 * Settings → Business profile (PaisaFollow).
 *
 * Name, currency, timezone and the contact / payment details that appear
 * in reminders. Admin+ can edit (RLS: accounts_update). The owner also
 * gets the danger zone: data export and permanent account deletion.
 */
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { CURRENCIES } from "@/lib/currency";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SettingsPanelHead } from "@/components/settings/settings-panel-head";
import { clearReceivablesCache } from "@/components/receivables/use-receivables";
import { LinkButton } from "@/components/receivables/shell";
import { DEFAULT_TIMEZONE, isValidTimeZone } from "@/lib/receivables/dates";
import { BUSINESS_PROFILE_COLUMNS, type BusinessProfile } from "@/lib/receivables/types";

const GSTIN = /^[0-9]{2}[0-9A-Z]{13}$/;
const UPI = /^[A-Za-z0-9._-]{2,256}@[A-Za-z][A-Za-z0-9.-]{1,63}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const selectClass =
  "h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-60";

function timeZones(current: string): string[] {
  let zones: string[] = [];
  try {
    zones = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone") ?? [];
  } catch {
    zones = [];
  }
  return [...new Set([DEFAULT_TIMEZONE, current, ...zones])].filter(Boolean);
}

type Form = Omit<BusinessProfile, "id">;
const EMPTY: Form = {
  name: "",
  default_currency: "INR",
  timezone: DEFAULT_TIMEZONE,
  business_address: null,
  business_phone: null,
  business_email: null,
  business_gstin: null,
  business_upi_id: null,
  business_logo_url: null,
};

export function BusinessSettings() {
  const t = useTranslations("Settings.business");
  const router = useRouter();
  const { accountId, canEditSettings, isOwner, refreshProfile, signOut } = useAuth();
  const [form, setForm] = useState<Form>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<keyof Form, string>>>({});
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [savedName, setSavedName] = useState("");
  const zones = useMemo(() => timeZones(form.timezone), [form.timezone]);

  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    createClient()
      .from("accounts")
      .select(BUSINESS_PROFILE_COLUMNS)
      .eq("id", accountId)
      .single()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error || !data) toast.error(t("loadFailed"));
        else {
          const { id: _id, ...rest } = data as BusinessProfile;
          void _id;
          setForm(rest);
          setSavedName(rest.name);
        }
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [accountId, t]);

  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => ({ ...f, [key]: value }));
  const clean = (v: string | null) => (v && v.trim() ? v.trim() : null);

  async function save(e: FormEvent) {
    e.preventDefault();
    const next: Partial<Record<keyof Form, string>> = {};
    const gstin = clean(form.business_gstin)?.toUpperCase() ?? null;
    const upi = clean(form.business_upi_id);
    const email = clean(form.business_email);
    const logo = clean(form.business_logo_url);
    if (!form.name.trim()) next.name = t("required");
    else if (form.name.trim().length > 80) next.name = t("tooLong", { max: 80 });
    if (!isValidTimeZone(form.timezone)) next.timezone = t("invalidTimezone");
    if (gstin && !GSTIN.test(gstin)) next.business_gstin = t("invalidGstin");
    if (upi && !UPI.test(upi)) next.business_upi_id = t("invalidUpi");
    if (email && !EMAIL.test(email)) next.business_email = t("invalidEmail");
    if (logo && !/^https:\/\//.test(logo)) next.business_logo_url = t("invalidLogo");
    setErrors(next);
    if (Object.keys(next).length > 0 || !accountId) return;

    setSaving(true);
    const { error } = await createClient()
      .from("accounts")
      .update({
        name: form.name.trim(),
        default_currency: form.default_currency,
        timezone: form.timezone,
        business_address: clean(form.business_address),
        business_phone: clean(form.business_phone),
        business_email: email,
        business_gstin: gstin,
        business_upi_id: upi,
        business_logo_url: logo,
      })
      .eq("id", accountId);
    setSaving(false);
    if (error) {
      toast.error(t("saveFailed"));
      return;
    }
    clearReceivablesCache();
    setSavedName(form.name.trim());
    await refreshProfile();
    toast.success(t("saved"));
  }

  async function deleteAccount() {
    setDeleting(true);
    try {
      const res = await fetch("/api/account", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: confirmText }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast.error(body.error ?? t("deleteFailed"));
        return;
      }
      clearReceivablesCache();
      toast.success(t("deleted"));
      await signOut().catch(() => undefined);
      router.replace("/login");
    } finally {
      setDeleting(false);
    }
  }

  const disabled = loading || !canEditSettings || saving;
  const field = (key: keyof Form, label: string, input: React.ReactNode, hint?: string) => (
    <div className="grid gap-1.5">
      <Label htmlFor={`biz-${key}`}>{label}</Label>
      {input}
      {errors[key] ? (
        <p role="alert" className="text-xs text-destructive">
          {errors[key]}
        </p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );

  return (
    <section className="max-w-2xl animate-in fade-in-50 duration-200">
      <SettingsPanelHead title={t("title")} description={t("description")} />
      <form onSubmit={save} noValidate>
        <Card>
          <CardHeader>
            <CardTitle>{t("profileTitle")}</CardTitle>
            <CardDescription>{canEditSettings ? t("profileDesc") : t("adminOnly")}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            {field("name", t("name"), <Input id="biz-name" value={form.name} onChange={(e) => set("name", e.target.value)} disabled={disabled} maxLength={80} />)}
            <div className="grid gap-4 sm:grid-cols-2">
              {field(
                "default_currency",
                t("currency"),
                <select id="biz-default_currency" className={selectClass} value={form.default_currency} onChange={(e) => set("default_currency", e.target.value)} disabled={disabled}>
                  {CURRENCIES.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.code} — {c.label}
                    </option>
                  ))}
                </select>,
                t("currencyHint"),
              )}
              {field(
                "timezone",
                t("timezone"),
                <select id="biz-timezone" className={selectClass} value={form.timezone} onChange={(e) => set("timezone", e.target.value)} disabled={disabled}>
                  {zones.map((z) => (
                    <option key={z} value={z}>
                      {z}
                    </option>
                  ))}
                </select>,
                t("timezoneHint"),
              )}
            </div>
            {field(
              "business_address",
              t("address"),
              <Textarea id="biz-business_address" rows={2} value={form.business_address ?? ""} onChange={(e) => set("business_address", e.target.value)} disabled={disabled} maxLength={500} />,
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              {field("business_phone", t("phone"), <Input id="biz-business_phone" inputMode="tel" value={form.business_phone ?? ""} onChange={(e) => set("business_phone", e.target.value)} disabled={disabled} maxLength={32} />)}
              {field("business_email", t("email"), <Input id="biz-business_email" type="email" value={form.business_email ?? ""} onChange={(e) => set("business_email", e.target.value)} disabled={disabled} maxLength={254} />)}
              {field("business_gstin", t("gstin"), <Input id="biz-business_gstin" value={form.business_gstin ?? ""} onChange={(e) => set("business_gstin", e.target.value.toUpperCase())} disabled={disabled} maxLength={15} placeholder="07ABCDE1234F1Z5" />)}
              {field(
                "business_upi_id",
                t("upi"),
                <Input id="biz-business_upi_id" value={form.business_upi_id ?? ""} onChange={(e) => set("business_upi_id", e.target.value)} disabled={disabled} placeholder="business@okaxis" />,
                t("upiHint"),
              )}
            </div>
            {field(
              "business_logo_url",
              t("logo"),
              <Input id="biz-business_logo_url" type="url" value={form.business_logo_url ?? ""} onChange={(e) => set("business_logo_url", e.target.value)} disabled={disabled} placeholder="https://" />,
              t("logoHint"),
            )}
            <div>
              <Button type="submit" disabled={disabled}>
                {saving && <Loader2 className="size-4 animate-spin" />}
                {saving ? t("saving") : t("save")}
              </Button>
            </div>
          </CardContent>
        </Card>
      </form>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>{t("dataTitle")}</CardTitle>
          <CardDescription>{t("dataDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <LinkButton variant="outline" href="/receivables/reports">
            {t("exportData")}
          </LinkButton>
        </CardContent>
      </Card>

      {isOwner && (
        <Card className="mt-6 border-destructive/40">
          <CardHeader>
            <CardTitle className="text-destructive">{t("dangerTitle")}</CardTitle>
            <CardDescription>{t("dangerDesc")}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="destructive" onClick={() => { setConfirmText(""); setDeleteOpen(true); }}>
              <Trash2 className="size-4" />
              {t("deleteAccount")}
            </Button>
          </CardContent>
        </Card>
      )}

      <Dialog open={deleteOpen} onOpenChange={(o) => !deleting && setDeleteOpen(o)}>
        <DialogContent className="border-border bg-popover text-popover-foreground sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("deleteTitle")}</DialogTitle>
            <DialogDescription>{t("deleteDesc")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="biz-delete-confirm">{t("deleteConfirmLabel", { name: savedName })}</Label>
            <Input id="biz-delete-confirm" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} autoComplete="off" />
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={deleting} onClick={() => setDeleteOpen(false)}>
              {t("cancel")}
            </Button>
            <Button variant="destructive" disabled={deleting || confirmText.trim() !== savedName.trim() || !savedName} onClick={deleteAccount}>
              {deleting && <Loader2 className="size-4 animate-spin" />}
              {t("deleteForever")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
