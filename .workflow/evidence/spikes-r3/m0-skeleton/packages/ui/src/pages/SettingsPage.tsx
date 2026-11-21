import { type ReactNode, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { bridge } from "../api/bridge";
import {
  fetchConfig,
  type ImageModelConfigIn,
  type TextModelConfigIn,
  toImageIn,
  toTextIn,
  updateConfig,
} from "../api/config-store";
import {
  type ApiFormat,
  apiFormats,
  type ImageTestResult,
  modelSlots,
  type TextSlot,
  type TextTestResult,
} from "../api/types";
import { Card } from "../components/Card";
import {
  CompactSelect,
  EmptyState,
  Field,
  SectionLabel,
  TextInput,
} from "../components/Form";
import { Button, Icon, Spinner } from "../components/Icon";
import { Page } from "../components/Page";
import { useToast } from "../components/Toast";
import s from "../components/ui.module.css";
import { type ThemeMode, useTheme } from "../shell/theme";

type TestState = "idle" | "testing" | "ok" | "fail";

interface TextDraft extends TextModelConfigIn {
  contextSourceHint?: boolean;
}
interface ImageDraft extends ImageModelConfigIn {}

function defaultText(apiFormat: ApiFormat = "openai-completions"): TextDraft {
  return {
    apiFormat,
    baseUrl: apiFormats.find((f) => f.value === apiFormat)?.defaultBase ?? "",
    model: "",
    contextLength: 0,
    apiKey: "",
    inheritFast: true,
  };
}

function SettingRow({
  icon,
  title,
  control,
}: {
  icon: string;
  title: string;
  control: ReactNode;
}) {
  return (
    <div className={s.settingRow}>
      <div className={`neu-button ${s.settingIcon}`}>
        <Icon name={icon} size={19} />
      </div>
      <div className={s.settingTitle}>{title}</div>
      <div style={{ flexShrink: 0 }}>{control}</div>
    </div>
  );
}

function RowDivider() {
  return <div className={s.rowDivider} />;
}

const failText = "连接失败 · 检查接口地址、API Key、模型名";

function ModelCard({
  icon,
  title,
  summary,
  configured,
  test,
  testError,
  onTest,
  result,
  children,
}: {
  icon: string;
  title: string;
  summary: string;
  configured: boolean;
  test: TestState;
  testError?: string;
  onTest: () => void;
  result?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const meta: Record<
    Exclude<TestState, "idle">,
    { text: string; icon: string; color: string }
  > = {
    testing: {
      text: "正在测试…",
      icon: "progress_activity",
      color: "var(--color-on-surface-variant)",
    },
    ok: {
      text: "连接成功",
      icon: "check_circle",
      color: "var(--color-success)",
    },
    fail: {
      text: testError || failText,
      icon: "error",
      color: "var(--color-on-error-container)",
    },
  };
  const m = test === "idle" ? null : meta[test];
  return (
    <Card style={{ padding: 0 }}>
      <div
        className={s.modelCardHead}
        onClick={() => setOpen(!open)}
        role="button"
      >
        <div className={`neu-button ${s.modelCardIcon}`}>
          <Icon name={icon} size={19} />
        </div>
        <div className={s.modelCardTitle}>
          <div className={s.modelCardName}>{title}</div>
          <div className={s.modelCardSummary}>{summary}</div>
        </div>
        <span className={configured ? s.configuredOk : s.configuredNo}>
          {configured ? "已配置" : "未配置"}
        </span>
        <span
          onClick={(e) => e.stopPropagation()}
          style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
        >
          <Button
            size="sm"
            icon="cable"
            disabled={test === "testing"}
            onClick={onTest}
          >
            测试
          </Button>
          {m ? (
            <span
              className={s.testStatus}
              style={{ color: m.color }}
              title={testError}
            >
              {test === "testing" ? (
                <Spinner size={13} />
              ) : (
                <Icon name={m.icon} size={14} />
              )}
              {m.text}
            </span>
          ) : null}
        </span>
        <Icon
          name={open ? "expand_less" : "expand_more"}
          size={18}
          style={{ color: "var(--color-outline)" }}
        />
      </div>
      {open ? (
        <div className={s.modelCardBody}>
          {test === "ok" && result ? result : null}
          <div className={s.modelGrid}>{children}</div>
        </div>
      ) : null}
    </Card>
  );
}

function TextModelFields({
  slot,
  draft,
  fast,
  onChange,
}: {
  slot: TextSlot;
  draft: TextDraft;
  fast: TextDraft;
  onChange: (d: TextDraft) => void;
}) {
  const inherit = slot !== "fast" && draft.inheritFast;
  return (
    <>
      <Field label="接口格式">
        <CompactSelect
          value={draft.apiFormat}
          onChange={(v) => {
            const f = v as ApiFormat;
            onChange({
              ...draft,
              apiFormat: f,
              baseUrl:
                apiFormats.find((x) => x.value === f)?.defaultBase ??
                draft.baseUrl,
            });
          }}
          options={apiFormats.map((f) => ({ value: f.value, label: f.label }))}
        />
      </Field>
      {slot !== "fast" ? (
        <div style={{ display: "flex", alignItems: "flex-end" }}>
          <Button
            size="sm"
            icon={draft.inheritFast ? "check_box" : "check_box_outline_blank"}
            onClick={() =>
              onChange({ ...draft, inheritFast: !draft.inheritFast })
            }
          >
            同快速模型
          </Button>
        </div>
      ) : null}
      <Field label="接口地址">
        <TextInput
          value={inherit ? fast.baseUrl : draft.baseUrl}
          placeholder="https://…"
          onChange={(v) => onChange({ ...draft, baseUrl: v })}
        />
      </Field>
      <Field label="模型名">
        <TextInput
          value={draft.model}
          placeholder="模型名"
          onChange={(v) => onChange({ ...draft, model: v })}
        />
      </Field>
      <Field
        label="上下文长度"
        hint={draft.contextSourceHint ? undefined : "目录里没有，可以手填"}
      >
        <TextInput
          value={draft.contextLength > 0 ? String(draft.contextLength) : ""}
          placeholder="如 200000"
          onChange={(v) =>
            onChange({
              ...draft,
              contextLength: Number(v.replace(/\D/g, "")) || 0,
            })
          }
        />
      </Field>
      <Field label="API Key">
        <TextInput
          type="password"
          value={inherit ? fast.apiKey : draft.apiKey}
          placeholder="sk-…"
          onChange={(v) => onChange({ ...draft, apiKey: v })}
        />
      </Field>
    </>
  );
}

type DraftText = TextDraft;

export function SettingsPage() {
  const { t } = useTranslation();
  const toast = useToast();
  const { mode, setMode } = useTheme();

  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<{
    path: string;
    error: string;
  } | null>(null);
  const [texts, setTexts] = useState<Record<TextSlot, DraftText>>({
    fast: defaultText(),
    main: defaultText(),
    writing: defaultText(),
    visual: defaultText(),
  });
  const [image, setImage] = useState<ImageDraft>({
    baseUrl: apiFormats[0]?.defaultBase ?? "",
    model: "",
    apiKey: "",
    concurrency: 8,
    retries: 3,
  });
  const [tests, setTests] = useState<Record<TextSlot | "image", TestState>>({
    fast: "idle",
    main: "idle",
    writing: "idle",
    visual: "idle",
    image: "idle",
  });
  const [testErr, setTestErr] = useState<Record<string, string>>({});
  const [imageResult, setImageResult] = useState<ImageTestResult | null>(null);
  const [visualReply, setVisualReply] = useState<string>("");
  const [dir, setDir] = useState("");
  const [lang, setLang] = useState("zh-Hans");
  const [sqliteSmoke, setSqliteSmoke] = useState<{
    ok: boolean;
    detail: string;
  } | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 初始拉取
  useEffect(() => {
    fetchConfig()
      .then((r) => {
        const c = r.config;
        setTexts({
          fast: {
            ...toTextIn(c.models.fast),
            contextSourceHint: c.models.fast.contextSource === "catalog",
          },
          main: {
            ...toTextIn(c.models.main),
            contextSourceHint: c.models.main.contextSource === "catalog",
          },
          writing: {
            ...toTextIn(c.models.writing),
            contextSourceHint: c.models.writing.contextSource === "catalog",
          },
          visual: {
            ...toTextIn(c.models.visual),
            contextSourceHint: c.models.visual.contextSource === "catalog",
          },
        });
        setImage(toImageIn(c.image));
        setDir(c.project.defaultDir);
        setLang(c.interface.language);
        setMode(c.interface.theme);
        setLoadError(
          r.loadError ? { path: r.configPath, error: r.loadError } : null,
        );
        setLoaded(true);
      })
      .catch((e) => {
        setLoadError({
          path: "config.json",
          error: String((e as { message?: string })?.message ?? e),
        });
        setLoaded(true);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setMode]);

  // 防抖回写：字段变化 600ms 后 config.update
  const persist = (patch: Parameters<typeof updateConfig>[0]) => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    saveTimer.current = setTimeout(() => {
      updateConfig(patch).catch((e) =>
        toast(
          `保存失败：${(e as { message?: string })?.message ?? e}`,
          "error",
        ),
      );
    }, 600);
  };

  const setText = (slot: TextSlot) => (d: DraftText) => {
    setTexts((prev) => ({ ...prev, [slot]: d }));
    setTests((prev) => ({ ...prev, [slot]: "idle" }));
    persist({ models: { [slot]: d } });
  };

  const setImageField = (patch: Partial<ImageDraft>) => {
    setImage((img) => {
      const next = { ...img, ...patch };
      persist({ image: next });
      return next;
    });
    setTests((prev) => ({ ...prev, image: "idle" }));
    setImageResult(null);
  };

  const textReady = (slot: TextSlot) => {
    const c = texts[slot];
    const inherit = slot !== "fast" && c.inheritFast;
    const base = inherit ? texts.fast.baseUrl : c.baseUrl;
    const key = inherit ? texts.fast.apiKey : c.apiKey;
    return (
      base.trim().length > 0 &&
      key.trim().length > 0 &&
      c.model.trim().length > 0
    );
  };

  const runTextTest = async (slot: TextSlot) => {
    setTests((prev) => ({ ...prev, [slot]: "testing" }));
    setTestErr((e) => ({ ...e, [slot]: "" }));
    // 先落盘再测，保证服务端读到的就是界面上的值
    try {
      await updateConfig({ models: { [slot]: texts[slot] } });
    } catch {
      /* 保存失败不挡测试 */
    }
    try {
      const res = (await bridge().call("model.testText", { slot }).promise) as {
        test: TextTestResult;
      };
      if (res.test.ok) {
        setTests((prev) => ({ ...prev, [slot]: "ok" }));
        if (slot === "visual") setVisualReply(res.test.reply ?? "");
      } else {
        setTests((prev) => ({ ...prev, [slot]: "fail" }));
        setTestErr((e) => ({
          ...e,
          [slot]: res.test.error?.message ?? failText,
        }));
      }
    } catch (e) {
      const err = e as { code?: string; message?: string };
      setTests((prev) => ({ ...prev, [slot]: "fail" }));
      setTestErr((prev) => ({ ...prev, [slot]: err?.message ?? failText }));
    }
  };

  const runImageTest = async () => {
    setTests((prev) => ({ ...prev, image: "testing" }));
    setImageResult(null);
    setTestErr((e) => ({ ...e, image: "" }));
    try {
      await updateConfig({ image });
    } catch {
      /* ignore */
    }
    try {
      const res = (await bridge().call("model.testImage", {}).promise) as {
        test: ImageTestResult;
        overallOk: boolean;
      };
      setImageResult(res.test);
      const anyOk =
        res.test.t2i.state === "ok" ||
        res.test.transparent.state === "ok" ||
        res.test.edit.state === "ok";
      setTests((prev) => ({ ...prev, image: anyOk ? "ok" : "fail" }));
      if (!anyOk)
        setTestErr((prev) => ({
          ...prev,
          image: res.test.t2i.error?.message ?? failText,
        }));
    } catch (e) {
      const err = e as { message?: string };
      setTests((prev) => ({ ...prev, image: "fail" }));
      setTestErr((prev) => ({ ...prev, image: err?.message ?? failText }));
    }
  };

  const pickDir = async () => {
    const p = await bridge().pickFolder();
    if (p) {
      setDir(p);
      persist({ project: { defaultDir: p } });
    }
  };

  const capMeta: Record<
    string,
    { icon: string; label: string; color: string }
  > = {
    ok: {
      icon: "check_circle",
      label: t("settings.capOk"),
      color: "var(--color-success)",
    },
    unsupported: {
      icon: "error",
      label: t("settings.capUnsupported"),
      color: "var(--color-on-error-container)",
    },
    fail: {
      icon: "error",
      label: t("settings.capFail"),
      color: "var(--color-on-error-container)",
    },
    skipped: { icon: "circle", label: "跳过", color: "var(--color-outline)" },
    testing: {
      icon: "progress_activity",
      label: t("settings.capTesting"),
      color: "var(--color-on-surface-variant)",
    },
  };

  const textSummary = (slot: TextSlot) => {
    const c = texts[slot];
    const f =
      apiFormats.find((x) => x.value === c.apiFormat)?.label ?? c.apiFormat;
    return `${c.model || "未填模型"} · ${f}${slot !== "fast" && c.inheritFast ? " · 同快速模型" : ""}`;
  };

  if (!loaded) {
    return (
      <Page title={t("settings.title")}>
        <Card>
          <EmptyState icon="settings" title="加载中" desc="" />
        </Card>
      </Page>
    );
  }

  return (
    <Page title={t("settings.title")} width={760}>
      <div className={s.settingsCol}>
        {loadError ? (
          <div className={s.configErr}>
            {t("settings.configError")}：{loadError.path} — {loadError.error}
          </div>
        ) : null}

        <section>
          <SectionLabel>{t("settings.models")}</SectionLabel>
          <div className={s.modelCol}>
            {(["fast", "main", "writing", "visual"] as const).map((slot) => {
              const meta = modelSlots.find((m) => m.id === slot)!;
              return (
                <ModelCard
                  key={slot}
                  icon={meta.icon}
                  title={meta.label}
                  summary={textSummary(slot)}
                  configured={textReady(slot)}
                  test={tests[slot]}
                  testError={testErr[slot]}
                  onTest={() => void runTextTest(slot)}
                  result={
                    slot === "visual" && visualReply ? (
                      <p
                        style={{
                          fontSize: 13,
                          color: "var(--color-on-surface-variant)",
                          lineHeight: 1.7,
                        }}
                      >
                        「{visualReply}」
                      </p>
                    ) : undefined
                  }
                >
                  <TextModelFields
                    slot={slot}
                    draft={texts[slot]}
                    fast={texts.fast}
                    onChange={setText(slot)}
                  />
                </ModelCard>
              );
            })}

            <ModelCard
              icon="image"
              title={t("settings.imageModel")}
              summary={image.model || "未填模型"}
              configured={
                image.apiKey.trim().length > 0 &&
                image.baseUrl.trim().length > 0 &&
                image.model.trim().length > 0
              }
              test={tests.image}
              testError={testErr.image}
              onTest={() => void runImageTest()}
              result={
                imageResult ? (
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: "var(--space-3)",
                    }}
                  >
                    <div className={s.capRow}>
                      {(["t2i", "transparent", "edit"] as const).map((cap) => {
                        const st =
                          tests.image === "testing"
                            ? "testing"
                            : imageResult[cap].state;
                        const m = capMeta[st] ?? capMeta.fail!;
                        return (
                          <span
                            key={cap}
                            className={s.capItem}
                            style={{ color: m.color }}
                          >
                            {st === "testing" ? (
                              <Spinner size={13} />
                            ) : (
                              <Icon name={m.icon} size={14} />
                            )}
                            {t(`settings.${cap}`)} · {m.label}
                          </span>
                        );
                      })}
                    </div>
                    {imageResult.transparent.state === "unsupported" ? (
                      <div
                        style={{
                          fontSize: 12,
                          color: "var(--color-on-surface-variant)",
                          lineHeight: 1.6,
                        }}
                      >
                        {t("settings.unsupportedHint")}
                      </div>
                    ) : null}
                    <div className={s.thumbRow}>
                      {(["t2i", "transparent", "edit"] as const).map((cap) => {
                        const p = imageResult[cap].thumbnailPath;
                        if (!p) return null;
                        return (
                          <img
                            key={cap}
                            className={s.thumb}
                            src={bridge().resourceUrl(p)}
                            alt={cap}
                          />
                        );
                      })}
                    </div>
                  </div>
                ) : undefined
              }
            >
              <Field label={t("settings.baseUrl")}>
                <TextInput
                  value={image.baseUrl}
                  placeholder="https://…/v1"
                  onChange={(v) => setImageField({ baseUrl: v })}
                />
              </Field>
              <Field label={t("settings.modelName")}>
                <TextInput
                  value={image.model}
                  onChange={(v) => setImageField({ model: v })}
                />
              </Field>
              <Field label={t("settings.concurrency")}>
                <TextInput
                  value={String(image.concurrency)}
                  onChange={(v) =>
                    setImageField({
                      concurrency: Number(v.replace(/\D/g, "")) || 8,
                    })
                  }
                />
              </Field>
              <Field label={t("settings.retries")}>
                <TextInput
                  value={String(image.retries)}
                  onChange={(v) =>
                    setImageField({
                      retries: Number(v.replace(/\D/g, "")) || 3,
                    })
                  }
                />
              </Field>
              <div style={{ gridColumn: "1 / -1" }}>
                <Field label={t("settings.apiKey")}>
                  <TextInput
                    type="password"
                    value={image.apiKey}
                    placeholder="sk-…"
                    onChange={(v) => setImageField({ apiKey: v })}
                  />
                </Field>
              </div>
            </ModelCard>
          </div>
        </section>

        <section>
          <SectionLabel>{t("settings.interface")}</SectionLabel>
          <Card style={{ padding: "2px 0" }}>
            <SettingRow
              icon="language"
              title={t("settings.language")}
              control={
                <CompactSelect
                  value={lang}
                  onChange={(v) => {
                    setLang(v);
                    persist({ interface: { language: v, theme: mode } });
                  }}
                  options={[
                    { value: "zh-Hans", label: "简体中文" },
                    { value: "zh-Hant", label: "繁體中文" },
                    { value: "en", label: "English" },
                    { value: "ja", label: "日本語" },
                  ]}
                />
              }
            />
            <RowDivider />
            <SettingRow
              icon="contrast"
              title={t("settings.theme")}
              control={
                <CompactSelect
                  value={mode}
                  onChange={(v) => {
                    const m = v as ThemeMode;
                    setMode(m);
                    persist({ interface: { language: lang, theme: m } });
                  }}
                  options={[
                    { value: "light", label: t("shell.themeLight") },
                    { value: "dark", label: t("shell.themeDark") },
                    { value: "system", label: t("shell.themeSystem") },
                  ]}
                />
              }
            />
          </Card>
        </section>

        <section>
          <SectionLabel>{t("settings.project")}</SectionLabel>
          <Card style={{ padding: "2px 0" }}>
            <SettingRow
              icon="folder_open"
              title={t("settings.defaultDir")}
              control={
                <div className={s.dirRow}>
                  <span className={s.dirText} title={dir}>
                    {dir || "未设置"}
                  </span>
                  <Button
                    size="sm"
                    icon="folder"
                    onClick={() => void pickDir()}
                  >
                    {t("settings.change")}
                  </Button>
                </div>
              }
            />
            <RowDivider />
            <SettingRow
              icon="database"
              title={t("settings.sqliteSmoke")}
              control={
                <div className={s.dirRow}>
                  {sqliteSmoke ? (
                    <span
                      style={{
                        fontSize: 12,
                        color: sqliteSmoke.ok
                          ? "var(--color-success)"
                          : "var(--color-on-error-container)",
                      }}
                    >
                      {sqliteSmoke.ok
                        ? t("settings.sqliteOk")
                        : t("settings.sqliteFail")}{" "}
                      {sqliteSmoke.detail}
                    </span>
                  ) : null}
                  <Button
                    size="sm"
                    icon="cable"
                    onClick={() => {
                      void bridge()
                        .call("debug.sqliteSmoke", {})
                        .promise.then((r) =>
                          setSqliteSmoke(
                            (r as { smoke: { ok: boolean; detail: string } })
                              .smoke,
                          ),
                        )
                        .catch((e) =>
                          setSqliteSmoke({
                            ok: false,
                            detail: String(
                              (e as { message?: string })?.message ?? e,
                            ),
                          }),
                        );
                    }}
                  >
                    {t("settings.test")}
                  </Button>
                </div>
              }
            />
          </Card>
        </section>

        <section>
          <SectionLabel>{t("settings.about")}</SectionLabel>
          <Card style={{ padding: "14px 18px" }}>
            <div className={s.aboutRow}>
              <Icon
                name="auto_stories"
                size={22}
                style={{ color: "var(--color-primary)" }}
              />
              <div style={{ flex: 1 }}>
                <div className={s.aboutName}>Novelive</div>
                <div className={s.aboutDesc}>
                  把小说改编为视觉小说并直接游玩。
                </div>
              </div>
              <span className={s.aboutVersion}>v0.1.0 · AGPL-3.0</span>
            </div>
          </Card>
        </section>
      </div>
    </Page>
  );
}
