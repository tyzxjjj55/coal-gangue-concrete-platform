const http = require("http");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const { execFile } = require("child_process");
let nodemailer = null;
try {
  nodemailer = require("nodemailer");
} catch {
  nodemailer = null;
}

const PORT = Number(process.env.PORT || 5710);
const BASE_PATH = normalizeBase(process.env.BASE_PATH || "/edit");
const WORK_PATH = normalizeBase(process.env.WORK_PATH || "/work");
const SITE_DIR = process.env.SITE_DIR || "/var/www/xx520-site";
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const WORK_UPLOAD_DIR = process.env.WORK_UPLOAD_DIR || path.join(DATA_DIR, "work-uploads");
const WORK_FILE_PATH = `${WORK_PATH}/files`;
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(SITE_DIR, "uploads");
const PUBLIC_UPLOAD_PATH = "/uploads";
const PUBLIC_THUMB_DIR = process.env.PUBLIC_THUMB_DIR || path.join(SITE_DIR, "thumbs");
const PUBLIC_THUMB_PATH = "/thumbs";
const PRIVATE_UPLOAD_DIR = process.env.PRIVATE_UPLOAD_DIR || path.join(SITE_DIR, "private-uploads");
const PRIVATE_UPLOAD_PATH = "/private-uploads";
const PRIVATE_THUMB_DIR = process.env.PRIVATE_THUMB_DIR || path.join(SITE_DIR, "private-thumbs");
const PRIVATE_THUMB_PATH = "/private-thumbs";
const PRIVATE_GALLERY_PATH = "/private-gallery";
const CONTENT_FILE = path.join(DATA_DIR, "content.json");
const REMINDER_STATE_FILE = path.join(DATA_DIR, "reminder-state.json");
const SESSION_SECRET_FILE = path.join(DATA_DIR, "session-secret");
const BACKUP_DIR = path.join(DATA_DIR, "backups");
const BACKUP_KEEP = Number(process.env.BACKUP_KEEP || 30);
const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES || 20 * 1024 * 1024);
const THUMB_WIDTH = Number(process.env.THUMB_WIDTH || 900);
const DEFAULT_ALBUM = "默认相册";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
const LOGIN_ATTEMPT_WINDOW_MS = 10 * 60 * 1000;
const LOGIN_ATTEMPT_LIMIT = 8;
const CSRF_COOKIE_NAME = "xx520_csrf_token";
const CSRF_TOKEN_BYTES = 24;
const WORK_LOGIN_USER = process.env.WORK_LOGIN_USER || "xx";
const WORK_LOGIN_PASS = requiredEnv("WORK_LOGIN_PASS");
const ADMIN_LOGIN_USER = process.env.ADMIN_LOGIN_USER || WORK_LOGIN_USER;
const ADMIN_LOGIN_PASS = process.env.ADMIN_LOGIN_PASS || WORK_LOGIN_PASS;
const PRIVATE_GALLERY_PASS = requiredEnv("PRIVATE_GALLERY_PASS");
const REMINDER_HOUR = Number(process.env.REMINDER_HOUR || 8);
const REMINDER_INTERVAL_MS = 10 * 60 * 1000;
const SMTP_CONFIG = {
  host: process.env.SMTP_HOST || "",
  port: Number(process.env.SMTP_PORT || 465),
  secure: String(process.env.SMTP_SECURE || "true") !== "false",
  user: process.env.SMTP_USER || "",
  pass: process.env.SMTP_PASS || "",
  to: process.env.SMTP_TO || process.env.SMTP_USER || ""
};
const WEATHER_CONFIG = {
  enabled: String(process.env.WEATHER_ENABLED || "true") !== "false",
  location: process.env.WEATHER_LOCATION || "太原理工大学虎峪校区",
  latitude: Number(process.env.WEATHER_LAT || 37.85261),
  longitude: Number(process.env.WEATHER_LON || 112.51659),
  timezone: process.env.WEATHER_TIMEZONE || "Asia/Shanghai"
};

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const allowedTypes = new Map([
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/webp", ".webp"],
  ["image/gif", ".gif"]
]);

const BUILTIN_RESULT_METRICS = [
  { id: "compressionStrength", label: "抗压强度", placeholder: "例：36.8MPa" },
  { id: "flexuralStrength", label: "抗折强度", placeholder: "例：5.2MPa" },
  { id: "splitTensileStrength", label: "劈裂抗拉强度", placeholder: "例：3.4MPa" },
  { id: "elasticModulus", label: "弹性模量", placeholder: "例：32.5GPa" },
  { id: "impermeability", label: "抗渗等级", placeholder: "例：P8" },
  { id: "mass", label: "试件重量", placeholder: "例：8.2kg" },
  { id: "failureMode", label: "破坏形态", placeholder: "例：正常破坏" }
];
const DEFAULT_RESULT_METRIC_IDS = ["compressionStrength"];

const BUILTIN_RECIPE_MATERIALS = [
  { id: "cement", label: "硅酸盐水泥", category: "binder", placeholder: "例：1485g" },
  { id: "flyAsh", label: "粉煤灰", category: "binder", placeholder: "例：50g" },
  { id: "mineralPowder", label: "矿粉", category: "binder", placeholder: "例：30g" },
  { id: "silicaFume", label: "硅灰", category: "binder", placeholder: "例：20g" },
  { id: "admixture", label: "外加剂", category: "admixture", placeholder: "例：6.2g" },
  { id: "expansiveAgent", label: "膨胀剂", category: "admixture", placeholder: "例：8g" },
  { id: "accelerator", label: "速凝剂", category: "admixture", placeholder: "例：4g" },
  { id: "fiber", label: "纤维", category: "admixture", placeholder: "例：0.9g" },
  { id: "sand", label: "砂", category: "aggregate", placeholder: "例：760g" },
  { id: "stone", label: "石子", category: "aggregate", placeholder: "例：1080g" },
  { id: "water", label: "水", category: "water", placeholder: "例：165g" }
];
const DEFAULT_RECIPE_MATERIAL_IDS = ["cement", "flyAsh", "生石灰", "煤矸石", "硫酸钠", "accelerator", "water"];
const EXPERIMENT_MATERIAL_LABELS = ["硅酸盐水泥", "粉煤灰", "生石灰", "煤矸石", "硫酸钠", "速凝剂", "水"];
const BLOCK_CATEGORIES = [
  { id: "spray", label: "喷浆", scheme: "A", note: "0.15-4.75mm，默认带速凝剂" },
  { id: "road", label: "道路", scheme: "B", note: "0.15-16mm，可选速凝剂" }
];
const GRADATION_SCHEMES = {
  spray: {
    label: "方案 A：0.15-4.75mm",
    ranges: ["0.15-0.30", "0.30-0.60", "0.60-1.18", "1.18-2.36", "2.36-4.75"],
    templates: {
      raw: { label: "原始级配", nValue: "", weights: null },
      n04: { label: "n=0.4", nValue: "0.4", weights: [424, 560, 718, 968, 1290] },
      n05: { label: "n=0.5", nValue: "0.5", weights: [354, 501, 689, 994, 1422] },
      n06: { label: "n=0.6", nValue: "0.6", weights: [294, 445, 655, 1013, 1553] }
    }
  },
  road: {
    label: "方案 B：0.15-16mm",
    ranges: ["0.15-0.30", "0.30-0.60", "0.60-1.18", "1.18-2.36", "2.36-4.75", "4.75-9.5", "9.5-16"],
    templates: {
      raw: { label: "原始级配", nValue: "", weights: null },
      n04: { label: "n=0.4", nValue: "0.4", weights: [231, 305, 391, 527, 703, 921, 882] },
      n05: { label: "n=0.5", nValue: "0.5", weights: [176, 249, 342, 493, 705, 990, 1005] },
      n06: { label: "n=0.6", nValue: "0.6", weights: [132, 200, 294, 455, 697, 1049, 1133] }
    }
  }
};
const WEIGHING_TEMPLATES = {
  withAccelerator: {
    label: "有速凝剂",
    totalWithoutWater: "6098.4",
    values: { "硅酸盐水泥": "1485", "粉煤灰": "435.6", "生石灰": "59.4", "煤矸石": "3960", "硫酸钠": "59.4", "速凝剂": "99.0", "水": "825" }
  },
  withoutAccelerator: {
    label: "无速凝剂",
    totalWithoutWater: "5999.4",
    values: { "硅酸盐水泥": "1485", "粉煤灰": "435.6", "生石灰": "59.4", "煤矸石": "3960", "硫酸钠": "59.4", "水": "825" }
  },
  strengthBoost: {
    label: "强度加强：40%胶凝材料 + 水825",
    totalWithoutWater: "6130",
    values: { "硅酸盐水泥": "1782", "粉煤灰": "523", "生石灰": "71", "煤矸石": "3564", "硫酸钠": "71", "速凝剂": "119", "水": "825" },
    note: "强度加强方案：40%胶凝材料 + 水825"
  }
};
const RECIPE_MATERIAL_CATEGORIES = [
  { id: "binder", label: "胶凝材料" },
  { id: "admixture", label: "外加剂" },
  { id: "aggregate", label: "骨料" },
  { id: "water", label: "水" }
];
const LAB_IMAGE_KINDS = [
  { id: "gangueRaw", label: "矸石原始图" },
  { id: "gradation", label: "级配/称重图" },
  { id: "crushing", label: "压碎值试验图" },
  { id: "density", label: "密度/吸水率图" },
  { id: "flakiness", label: "针片状试验图" },
  { id: "forming", label: "成型/拆模图" },
  { id: "demold", label: "拆模图" },
  { id: "curing", label: "养护过程图" },
  { id: "pressureReading", label: "压力读数图" },
  { id: "compressionFailure", label: "抗压破坏图" },
  { id: "splitSection", label: "劈裂断面图" },
  { id: "flexuralFailure", label: "抗折破坏图" },
  { id: "block", label: "试块图片" },
  { id: "split", label: "劈裂/破坏后" },
  { id: "other", label: "其他实验图" }
];
const GANGUE_LAB_IMAGE_KIND_IDS = ["gangueRaw", "gradation", "crushing", "density", "flakiness", "other"];
const BLOCK_LAB_IMAGE_KIND_IDS = ["forming", "demold", "curing", "pressureReading", "compressionFailure", "splitSection", "flexuralFailure", "block", "split", "other"];

let sessionSecret = "";

const defaultContent = {
  siteTitle: "xx520 小站",
  brandName: "xx520 小站",
  eyebrow: "Quiet notes, tiny tools, daily traces",
  heroTitle: "把零散的想法，慢慢整理成一个小站。",
  lead: "这里会放一些日常笔记、折腾记录和小项目想法。先把空间搭起来，内容再一点点长出来。",
  aboutKicker: "关于这里",
  aboutTitle: "一个轻量、安静、可持续维护的个人主页。",
  aboutBody: "小站先保持简单：不追求复杂功能，只留下能长期更新的结构。以后可以继续加文章、项目记录、书签和状态页。",
  notes: [
    {
      date: "2026-05-08",
      title: "小站上线记录",
      body: "从一个干净的静态页面开始，先把入口、版式和更新节奏定下来。"
    }
  ],
  ideas: [
    {
      tag: "Notes",
      title: "公开笔记",
      body: "写一些短记录，方便回看，也方便之后扩展成博客。"
    }
  ],
  gallery: [],
  recipeMaterialLibrary: [],
  disabledRecipeMaterialIds: [],
  dismissedAnomalies: [],
  coalGangueDb: [],
  testBlocks: [],
  footerName: "xx520 小站",
  updatedAt: "2026-05-08"
};

function normalizeBase(value) {
  let base = value.trim() || "/edit";
  if (!base.startsWith("/")) base = `/${base}`;
  return base.replace(/\/+$/, "");
}

function html(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function attr(value) {
  return html(value).replaceAll("\n", " ");
}

function scriptJson(value) {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026");
}

function parseCookies(req) {
  const cookies = new Map();
  String(req.headers.cookie || "").split(";").forEach((part) => {
    const index = part.indexOf("=");
    if (index <= 0) return;
    const name = part.slice(0, index).trim();
    let value = part.slice(index + 1).trim();
    try {
      value = decodeURIComponent(value);
    } catch {
      value = "";
    }
    if (name) cookies.set(name, value);
  });
  return cookies;
}

function appendSetCookie(res, cookie) {
  const current = res.getHeader("Set-Cookie");
  if (!current) {
    res.setHeader("Set-Cookie", cookie);
  } else if (Array.isArray(current)) {
    res.setHeader("Set-Cookie", [...current, cookie]);
  } else {
    res.setHeader("Set-Cookie", [current, cookie]);
  }
}

function sessionSignature(scope, expiresAt) {
  return crypto
    .createHmac("sha256", sessionSecret)
    .update(`${scope}.${expiresAt}`)
    .digest("base64url");
}

function sessionCookieValue(scope) {
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  return `${scope}.${expiresAt}.${sessionSignature(scope, expiresAt)}`;
}

function validSession(req, cookieName, scope) {
  if (!sessionSecret) return false;
  const value = parseCookies(req).get(cookieName) || "";
  const [cookieScope, expiresAtText, signature] = value.split(".");
  const expiresAt = Number(expiresAtText);
  if (cookieScope !== scope || !Number.isFinite(expiresAt) || expiresAt < Math.floor(Date.now() / 1000) || !signature) {
    return false;
  }
  const expected = sessionSignature(scope, expiresAt);
  const expectedBuffer = Buffer.from(expected);
  const signatureBuffer = Buffer.from(signature);
  return expectedBuffer.length === signatureBuffer.length && crypto.timingSafeEqual(expectedBuffer, signatureBuffer);
}

function setLoginCookie(res, cookieName, scope) {
  appendSetCookie(res, `${cookieName}=${encodeURIComponent(sessionCookieValue(scope))}; Path=/; Max-Age=${SESSION_TTL_SECONDS}; HttpOnly; Secure; SameSite=Lax`);
}

function clearLoginCookie(res, cookieName) {
  appendSetCookie(res, `${cookieName}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`);
}

function csrfCookieValue() {
  return crypto.randomBytes(CSRF_TOKEN_BYTES).toString("base64url");
}

function setCsrfCookie(res, token) {
  appendSetCookie(res, `${CSRF_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; Max-Age=${SESSION_TTL_SECONDS}; HttpOnly; Secure; SameSite=Lax`);
}

function clearCsrfCookie(res) {
  appendSetCookie(res, `${CSRF_COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`);
}

function ensureCsrfToken(req, res) {
  let token = parseCookies(req).get(CSRF_COOKIE_NAME) || "";
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(token)) {
    token = csrfCookieValue();
    setCsrfCookie(res, token);
  }
  return token;
}

function csrfField(token) {
  return `<input type="hidden" name="_csrf" value="${attr(token)}">`;
}

function injectCsrfFields(body, token) {
  return String(body).replace(/<form\b[^>]*>/gi, (tag) => {
    if (!/\bmethod\s*=\s*["']?post/i.test(tag) || /\bdata-no-csrf\b/i.test(tag)) return tag;
    return `${tag}
      ${csrfField(token)}`;
  });
}

function safeNext(value, fallback, prefixes) {
  const next = String(value || "").trim();
  if (!next.startsWith("/") || next.startsWith("//")) return fallback;
  return prefixes.some((prefix) => next === prefix || next.startsWith(`${prefix}/`)) ? next : fallback;
}

function stamp() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-");
}

function today() {
  const parts = beijingParts();
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function beijingParts(date = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date).map((part) => [part.type, part.value]));
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: Number(parts.hour),
    minute: Number(parts.minute)
  };
}

function normalizeDateValue(value, fallback = today()) {
  const date = String(value || "").trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : fallback;
}

function optionalDateValue(value) {
  const date = String(value || "").trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : "";
}

function normalizeAges(value) {
  const raw = Array.isArray(value) ? value.join(",") : String(value || "");
  const ages = raw
    .split(/[\s,，、;；/]+/)
    .map((item) => Number.parseInt(item, 10))
    .filter((age) => Number.isInteger(age) && age > 0 && age <= 365);
  return [...new Set(ages)].sort((a, b) => a - b);
}

function normalizeCompleted(value, ages = []) {
  const source = value && typeof value === "object" ? value : {};
  const ageSource = source.ages && typeof source.ages === "object" ? source.ages : {};
  const deletedSource = source.deleted && typeof source.deleted === "object" ? source.deleted : {};
  const deletedAgeSource = deletedSource.ages && typeof deletedSource.ages === "object" ? deletedSource.ages : {};
  const completedAges = {};
  const deletedAges = {};
  ages.forEach((age) => {
    const key = String(age);
    completedAges[key] = ageSource[key] === true || ageSource[key] === "true" || ageSource[key] === "1";
    deletedAges[key] = deletedAgeSource[key] === true || deletedAgeSource[key] === "true" || deletedAgeSource[key] === "1";
  });
  return {
    demold: source.demold === true || source.demold === "true" || source.demold === "1",
    ages: completedAges,
    deleted: {
      demold: deletedSource.demold === true || deletedSource.demold === "true" || deletedSource.demold === "1",
      ages: deletedAges
    }
  };
}

function metricIdFromLabel(label) {
  return `custom_${crypto.createHash("sha1").update(String(label || "")).digest("hex").slice(0, 10)}`;
}

function splitMetricText(value) {
  return String(value || "")
    .split(/[\n,，、;；/]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeResultMetrics(value, customValue = "", options = {}) {
  const fallbackToDefault = options.fallbackToDefault !== false;
  const metrics = new Map();
  const builtins = new Map(BUILTIN_RESULT_METRICS.map((item) => [item.id, item]));

  const addMetric = (item, forceCustom = false) => {
    if (item === undefined || item === null) return;
    if (typeof item === "string") {
      const text = item.trim();
      if (!text) return;
      const builtin = builtins.get(text) || BUILTIN_RESULT_METRICS.find((metric) => metric.label === text);
      if (builtin && !forceCustom) {
        metrics.set(builtin.id, { ...builtin, custom: false });
        return;
      }
      const label = text.slice(0, 32);
      metrics.set(metricIdFromLabel(label), { id: metricIdFromLabel(label), label, placeholder: "填写检测值", custom: true });
      return;
    }
    if (typeof item === "object") {
      const id = String(item.id || "").trim();
      const label = String(item.label || "").trim();
      const builtin = id ? builtins.get(id) : BUILTIN_RESULT_METRICS.find((metric) => metric.label === label);
      if (builtin && !forceCustom) {
        metrics.set(builtin.id, { ...builtin, custom: false });
        return;
      }
      if (!label) return;
      const metricId = id && /^custom_[a-f0-9]{10}$/.test(id) ? id : metricIdFromLabel(label);
      metrics.set(metricId, {
        id: metricId,
        label: label.slice(0, 32),
        placeholder: String(item.placeholder || "填写检测值").trim() || "填写检测值",
        custom: true
      });
    }
  };

  const source = Array.isArray(value) ? value : splitMetricText(value);
  source.forEach((item) => addMetric(item));
  splitMetricText(customValue).forEach((item) => addMetric(item, true));

  if (!metrics.size && fallbackToDefault) {
    DEFAULT_RESULT_METRIC_IDS.forEach((id) => addMetric(id));
  }
  return Array.from(metrics.values());
}

function normalizeMetricValues(value, metrics, legacy = {}) {
  const source = value && typeof value === "object" ? value : {};
  const values = {};
  metrics.forEach((metric) => {
    values[metric.id] = String(source[metric.id] || legacy[metric.id] || "").trim();
  });
  return values;
}

function normalizeDismissedAnomalyIds(value) {
  return [...new Set((Array.isArray(value) ? value : splitMetricText(value))
    .map((item) => String(item || "").trim())
    .filter((item) => /^[a-z0-9:._-]{6,160}$/i.test(item)))];
}

function parseResultSamples(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item ?? "").trim())
      .filter((item) => item && parseMeasurementNumber(item) !== null)
      .slice(0, 12);
  }
  return String(value || "")
    .split(/[\s,，、;；/|]+/)
    .map((item) => item.trim())
    .filter((item) => item && parseMeasurementNumber(item) !== null)
    .slice(0, 12);
}

function calculateResultSamples(samples) {
  const values = parseResultSamples(samples);
  const numbers = values.map(parseMeasurementNumber).filter((number) => number !== null);
  if (!numbers.length) {
    return { values, mean: "", std: "", cv: "", meanSource: "未录入" };
  }
  const mean = numbers.reduce((total, number) => total + number, 0) / numbers.length;
  const variance = numbers.length > 1
    ? numbers.reduce((total, number) => total + ((number - mean) ** 2), 0) / (numbers.length - 1)
    : null;
  const std = variance === null ? "" : Math.sqrt(variance);
  const cv = variance === null || mean === 0 ? "" : (std / mean) * 100;
  return {
    values,
    mean: formatRecipeNumber(mean, 3),
    std: std === "" ? "" : formatRecipeNumber(std, 3),
    cv: cv === "" ? "" : formatRecipeNumber(cv, 2),
    meanSource: numbers.length >= 3 ? "三块计算" : numbers.length === 2 ? "多块计算" : "单块计算"
  };
}

function strengthFromPressureArea(pressureKn, areaMm2) {
  const pressure = parseMeasurementNumber(pressureKn);
  const area = parseMeasurementNumber(areaMm2);
  if (pressure === null || area === null || area <= 0) return "";
  return formatRecipeNumber((pressure * 1000) / area, 3);
}

function normalizeSampleMeasurements(value, fallbackValues = []) {
  const fallback = parseResultSamples(fallbackValues).map((strengthMpa) => ({
    pressureKn: "",
    areaMm2: "",
    strengthMpa,
    failureMode: "",
    remark: ""
  }));
  const rows = (Array.isArray(value) ? value : [])
    .map((item) => {
      if (item && typeof item === "object") {
        const pressureKn = String(item.pressureKn ?? item.pressure ?? item.loadKn ?? "").trim();
        const areaMm2 = String(item.areaMm2 ?? item.area ?? item.bearingArea ?? "").trim();
        const computed = strengthFromPressureArea(pressureKn, areaMm2);
        return {
          pressureKn,
          areaMm2,
          strengthMpa: String(item.strengthMpa ?? item.strength ?? item.value ?? computed ?? "").trim() || computed,
          failureMode: String(item.failureMode || "").trim(),
          remark: String(item.remark || item.note || "").trim()
        };
      }
      return {
        pressureKn: "",
        areaMm2: "",
        strengthMpa: String(item || "").trim(),
        failureMode: "",
        remark: ""
      };
    })
    .filter((item) => item.pressureKn || item.areaMm2 || item.strengthMpa || item.failureMode || item.remark);
  return rows.length ? rows : fallback;
}

function sampleValuesFromMeasurements(rows) {
  return normalizeSampleMeasurements(rows)
    .map((item) => item.strengthMpa)
    .filter((item) => parseMeasurementNumber(item) !== null);
}

function normalizeMetricResultEntry(value, legacyValue = "", options = {}) {
  const source = value && typeof value === "object" ? value : {};
  const sampleMeasurements = normalizeSampleMeasurements(
    source.sampleMeasurements || source.specimens,
    source.sampleValues || source.samples || source.values
  );
  const measuredValues = sampleValuesFromMeasurements(sampleMeasurements);
  const sampleValues = measuredValues.length ? measuredValues : parseResultSamples(source.sampleValues || source.samples || source.values);
  const legacyText = String(legacyValue || "").trim();
  const rawManual = source.manualMean ?? source.manualValue ?? source.value ?? "";
  const manualMean = String(rawManual || (!sampleValues.length ? (source.mean || legacyText) : "") || "").trim();
  const sampleStats = calculateResultSamples(sampleValues);
  const hasSamples = sampleStats.values.length > 0;
  const mean = hasSamples ? sampleStats.mean : manualMean;
  const sourceLabel = hasSamples ? sampleStats.meanSource : (manualMean ? "手动录入" : "未录入");
  const measurementFailureMode = sampleMeasurements.map((item) => item.failureMode).filter(Boolean).join("；");
  const measurementRemark = sampleMeasurements.map((item) => item.remark).filter(Boolean).join("；");
  return {
    age: String(source.age || options.age || "").trim(),
    metric: String(source.metric || options.metric || "").trim(),
    dueDate: optionalDateValue(source.dueDate || options.dueDate || ""),
    sampleValues: sampleStats.values,
    sampleMeasurements,
    manualMean,
    mean,
    std: hasSamples ? sampleStats.std : "",
    cv: hasSamples ? sampleStats.cv : "",
    meanSource: sourceLabel,
    failureMode: String(source.failureMode || measurementFailureMode || "").trim(),
    remark: String(source.remark || source.resultNote || measurementRemark || "").trim()
  };
}

function metricResultFilled(entry) {
  const item = normalizeMetricResultEntry(entry);
  return item.sampleValues.length > 0 || Boolean(item.manualMean || item.mean);
}

function metricResultNumber(entry) {
  const item = normalizeMetricResultEntry(entry);
  return parseMeasurementNumber(item.mean || item.manualMean);
}

function formatMpaValue(value) {
  const number = parseMeasurementNumber(value);
  return number === null ? "" : `${formatRecipeNumber(number, 3)} MPa`;
}

function formatMpaNumberInput(value) {
  const number = parseMeasurementNumber(value);
  return number === null ? String(value || "").trim() : formatRecipeNumber(number, 3);
}

function metricResultDisplay(entry) {
  const item = normalizeMetricResultEntry(entry);
  if (!metricResultFilled(item)) return "未录入";
  const main = item.mean || item.manualMean || "";
  const mainText = formatMpaValue(main) || main;
  const cv = item.cv ? `，CV ${item.cv}%` : "";
  return `${mainText}${cv} · ${item.meanSource}`;
}

function metricsFromParams(params) {
  return normalizeResultMetrics(params.getAll("metrics"), params.get("customMetrics"), { fallbackToDefault: true });
}

function materialIdFromLabel(label) {
  return `material_${crypto.createHash("sha1").update(String(label || "")).digest("hex").slice(0, 10)}`;
}

function normalizeRecipeMaterialCategory(value, fallback = "binder") {
  const id = String(value || "").trim();
  return RECIPE_MATERIAL_CATEGORIES.some((category) => category.id === id) ? id : fallback;
}

function inferRecipeMaterialCategory(label) {
  const text = String(label || "");
  if (/^(水|拌合水|用水)$/.test(text)) return "water";
  if (/硫酸钠|外加剂|减水|膨胀|速凝|缓凝|引气|泵送|早强|纤维|剂/.test(text)) return "admixture";
  if (/水泥|粉煤灰|矿粉|硅灰|石灰|生石灰|水渣/.test(text)) return "binder";
  if (/砂|石|骨料|碎石|卵石|机制砂|河砂|煤矸石/.test(text)) return "aggregate";
  return "binder";
}

function recipeMaterialCategory(material) {
  const label = String(material && material.label || "").trim();
  const inferred = inferRecipeMaterialCategory(label);
  if (/^(水|拌合水|用水)$/.test(label)) return "water";
  if (/硫酸钠|速凝剂|外加剂|减水|膨胀|缓凝|引气|泵送|早强|纤维|剂/.test(label)) return "admixture";
  if (/硅酸盐水泥|水泥|粉煤灰|矿粉|硅灰|石灰|生石灰|水渣/.test(label)) return "binder";
  if (/煤矸石|砂|石|骨料|碎石|卵石|机制砂|河砂/.test(label)) return "aggregate";
  return normalizeRecipeMaterialCategory(material && material.category, inferred);
}

function recipeMaterialCategoryLabel(categoryId) {
  return RECIPE_MATERIAL_CATEGORIES.find((category) => category.id === categoryId)?.label || "胶凝材料";
}

function recipeMaterialCategoryOptions(selected) {
  const current = normalizeRecipeMaterialCategory(selected);
  return RECIPE_MATERIAL_CATEGORIES
    .map((category) => `<option value="${attr(category.id)}" ${category.id === current ? "selected" : ""}>${html(category.label)}</option>`)
    .join("");
}

function normalizeBlockCategory(value, fallback = "road") {
  const id = String(value || "").trim();
  if (BLOCK_CATEGORIES.some((item) => item.id === id)) return id;
  return BLOCK_CATEGORIES.some((item) => item.id === fallback) ? fallback : "road";
}

function blockCategoryLabelV3(value) {
  return BLOCK_CATEGORIES.find((item) => item.id === normalizeBlockCategory(value))?.label || "道路";
}

function blockCategoryOptionsV3(selected) {
  const current = normalizeBlockCategory(selected, "spray");
  return BLOCK_CATEGORIES
    .map((item) => `<option value="${attr(item.id)}" ${item.id === current ? "selected" : ""}>${html(item.label)} · ${html(item.note)}</option>`)
    .join("");
}

function sortRecipeMaterials(materials) {
  const order = new Map(RECIPE_MATERIAL_CATEGORIES.map((category, index) => [category.id, index]));
  return [...materials].sort((a, b) => {
    const byCategory = (order.get(recipeMaterialCategory(a)) ?? 99) - (order.get(recipeMaterialCategory(b)) ?? 99);
    if (byCategory) return byCategory;
    return a.label.localeCompare(b.label, "zh-CN");
  });
}

function experimentMaterialForLabel(label) {
  const text = String(label || "").trim();
  if (!text) return null;
  const builtin = BUILTIN_RECIPE_MATERIALS.find((item) => (
    item.label === text || (item.id === "cement" && /^(水泥|硅酸盐水泥)$/.test(text))
  ));
  if (builtin) return { ...builtin, custom: false };
  return {
    id: materialIdFromLabel(text),
    label: text.slice(0, 32),
    category: inferRecipeMaterialCategory(text),
    placeholder: "填写g重",
    custom: true
  };
}

function normalizeWeighingTemplate(value, category = "spray") {
  const key = String(value || "").trim();
  if (Object.hasOwn(WEIGHING_TEMPLATES, key)) return key;
  return normalizeBlockCategory(category, "spray") === "spray" ? "withAccelerator" : "withoutAccelerator";
}

function templateUsesAccelerator(key) {
  return Object.hasOwn(WEIGHING_TEMPLATES[normalizeWeighingTemplate(key)].values, "速凝剂");
}

function weighingTemplateOptionsV3(selected, category = "spray") {
  const current = normalizeWeighingTemplate(selected, category);
  return Object.entries(WEIGHING_TEMPLATES)
    .map(([key, item]) => `<option value="${attr(key)}" ${key === current ? "selected" : ""}>${html(item.label)}</option>`)
    .join("");
}

function templateRecipeMaterials(templateKey, existing = []) {
  const template = WEIGHING_TEMPLATES[normalizeWeighingTemplate(templateKey)];
  const materials = [
    ...normalizeRecipeMaterials(existing, "", { fallbackToDefault: false }),
    ...Object.keys(template.values).map(experimentMaterialForLabel).filter(Boolean)
  ];
  return normalizeRecipeMaterials(materials, "", { fallbackToDefault: false });
}

function materialIdForTemplateLabel(materials, label) {
  const text = String(label || "").trim();
  const normalized = normalizeRecipeMaterials(materials, "", { fallbackToDefault: false });
  const matched = normalized.find((item) => item.label === text)
    || (/^(水泥|硅酸盐水泥)$/.test(text) ? normalized.find((item) => item.id === "cement") : null)
    || normalized.find((item) => item.id === materialIdFromLabel(text));
  return matched?.id || "";
}

function applyWeighingTemplateToRecipeValues(recipeValues, materials, templateKey) {
  const template = WEIGHING_TEMPLATES[normalizeWeighingTemplate(templateKey)];
  const values = { ...(recipeValues || {}) };
  EXPERIMENT_MATERIAL_LABELS.forEach((label) => {
    const id = materialIdForTemplateLabel(materials, label);
    if (id && !Object.hasOwn(template.values, label)) values[id] = "";
  });
  Object.entries(template.values).forEach(([label, amount]) => {
    const id = materialIdForTemplateLabel(materials, label);
    if (id) values[id] = amount;
  });
  if (!templateUsesAccelerator(templateKey)) {
    const acceleratorId = materialIdForTemplateLabel(materials, "速凝剂");
    if (acceleratorId) values[acceleratorId] = "";
  }
  return values;
}

function gradationSchemeForCategory(category) {
  return GRADATION_SCHEMES[normalizeBlockCategory(category)] || GRADATION_SCHEMES.road;
}

function normalizeGradationTemplate(value) {
  const key = String(value || "").trim();
  return ["raw", "n04", "n05", "n06"].includes(key) ? key : "raw";
}

function gradationTemplateOptionsV3(category, selected = "raw") {
  const scheme = gradationSchemeForCategory(category);
  const current = normalizeGradationTemplate(selected);
  return Object.entries(scheme.templates)
    .map(([key, item]) => `<option value="${attr(key)}" ${key === current ? "selected" : ""}>${html(item.label)}</option>`)
    .join("");
}

function gradationWeightsForTemplate(category, templateKey) {
  const scheme = gradationSchemeForCategory(category);
  const template = scheme.templates[normalizeGradationTemplate(templateKey)] || scheme.templates.raw;
  if (!Array.isArray(template.weights)) return {};
  const weights = {};
  scheme.ranges.forEach((range, index) => {
    weights[range] = String(template.weights[index] ?? "").trim();
  });
  return weights;
}

function gradationCoefficientForTemplate(category, templateKey) {
  const scheme = gradationSchemeForCategory(category);
  const template = scheme.templates[normalizeGradationTemplate(templateKey)] || scheme.templates.raw;
  return String(template.nValue || "").trim();
}

function normalizeBlockGradationWeights(value, category = "road", templateKey = "raw") {
  const source = value && typeof value === "object" ? value : {};
  const fromTemplate = gradationWeightsForTemplate(category, templateKey);
  const ranges = gradationSchemeForCategory(category).ranges;
  const weights = {};
  ranges.forEach((range) => {
    weights[range] = String(source[range] ?? fromTemplate[range] ?? "").trim();
  });
  return weights;
}

function blockGradationWeightsFromParams(params, category = "road", templateKey = "raw", existing = {}) {
  const labels = params.getAll("blockGradationRange");
  const values = params.getAll("blockGradationWeight");
  const source = {};
  labels.forEach((label, index) => {
    const range = String(label || "").trim();
    if (range) source[range] = String(values[index] || "").trim();
  });
  return normalizeBlockGradationWeights(Object.keys(source).length ? source : existing, category, templateKey);
}

function blockHasAcceleratorV3(block) {
  const record = normalizeBlockRecord(block.record, block.ages, block.metrics, block.recipeMaterials);
  return normalizeRecipeMaterials(block.recipeMaterials || record.recipeMaterials, "", { fallbackToDefault: false })
    .some((material) => material.id === "accelerator" || /速凝剂/.test(material.label));
}

function inferBlockCategoryV3(item) {
  const explicit = String(item.blockCategory || item.category || item.blockType || "").trim();
  if (explicit) return normalizeBlockCategory(explicit);
  const name = String(item.name || item.part || "").trim();
  if (/喷浆|喷射/.test(name)) return "spray";
  if (blockHasAcceleratorV3(item)) return "spray";
  return "road";
}

function normalizeRecipeMaterials(value, customValue = "", options = {}) {
  const fallbackToDefault = options.fallbackToDefault !== false;
  const materials = new Map();
  const builtins = new Map(BUILTIN_RECIPE_MATERIALS.map((item) => [item.id, item]));
  const library = new Map();
  const librarySource = Array.isArray(options.library) ? options.library : [];
  [...BUILTIN_RECIPE_MATERIALS, ...librarySource].forEach((item) => {
    if (!item || typeof item !== "object") return;
    const id = String(item.id || "").trim();
    const label = String(item.label || "").trim();
    if (!id || !label) return;
    const category = recipeMaterialCategory(item);
    const normalized = {
      ...item,
      id,
      label: label.slice(0, 32),
      category,
      placeholder: String(item.placeholder || "填写g重或型号").trim() || "填写g重或型号",
      custom: !builtins.has(id)
    };
    library.set(id, normalized);
    library.set(label, normalized);
  });

  const addMaterial = (item, forceCustom = false) => {
    if (item === undefined || item === null) return;
    if (typeof item === "string") {
      const text = item.trim();
      if (!text) return;
      const builtin = builtins.get(text) || BUILTIN_RECIPE_MATERIALS.find((material) => material.label === text);
      if (builtin && !forceCustom) {
        materials.set(builtin.id, { ...builtin, custom: false });
        return;
      }
      const saved = library.get(text);
      if (saved && !forceCustom) {
        materials.set(saved.id, { ...saved, category: recipeMaterialCategory(saved) });
        return;
      }
      const label = text.slice(0, 32);
      const category = normalizeRecipeMaterialCategory(options.customCategory, inferRecipeMaterialCategory(label));
      materials.set(materialIdFromLabel(label), { id: materialIdFromLabel(label), label, category, placeholder: "填写g重或型号", custom: true });
      return;
    }
    if (typeof item === "object") {
      const id = String(item.id || "").trim();
      const label = String(item.label || "").trim();
      const builtin = id ? builtins.get(id) : BUILTIN_RECIPE_MATERIALS.find((material) => material.label === label);
      if (builtin && !forceCustom) {
        materials.set(builtin.id, { ...builtin, custom: false });
        return;
      }
      if (!label) return;
      const materialId = id && /^material_[a-f0-9]{10}$/.test(id) ? id : materialIdFromLabel(label);
      const category = recipeMaterialCategory({ label, category: item.category || options.customCategory });
      materials.set(materialId, {
        id: materialId,
        label: label.slice(0, 32),
        category,
        placeholder: String(item.placeholder || "填写g重或型号").trim() || "填写g重或型号",
        custom: true
      });
    }
  };

  const source = Array.isArray(value) ? value : splitMetricText(value);
  source.forEach((item) => addMaterial(item));
  splitMetricText(customValue).forEach((item) => addMaterial(item, true));

  if (!materials.size && fallbackToDefault) {
    DEFAULT_RECIPE_MATERIAL_IDS.forEach((id) => addMaterial(id));
  }
  return sortRecipeMaterials(Array.from(materials.values()));
}

function normalizeRecipeValues(value, materials, legacy = {}) {
  const source = value && typeof value === "object" ? value : {};
  const values = {};
  materials.forEach((material) => {
    values[material.id] = String(source[material.id] || legacy[material.id] || "").trim();
  });
  return values;
}

function recipeMaterialsFromParams(params, content = {}, existingMaterials = []) {
  return normalizeRecipeMaterials(params.getAll("recipeMaterials"), params.get("customRecipeMaterials"), {
    fallbackToDefault: false,
    customCategory: params.get("customRecipeMaterialCategory"),
    library: [
      ...normalizeRecipeMaterialLibrary(content.recipeMaterialLibrary),
      ...normalizeRecipeMaterials(existingMaterials, "", { fallbackToDefault: false })
    ]
  });
}

function normalizeDisabledRecipeMaterialIds(value) {
  const ids = Array.isArray(value) ? value : splitMetricText(value);
  const builtinIds = new Set(BUILTIN_RECIPE_MATERIALS.map((material) => material.id));
  return [...new Set(ids.map((item) => String(item || "").trim()).filter((id) => builtinIds.has(id)))];
}

function normalizeRecipeMaterialLibrary(value) {
  return normalizeRecipeMaterials(value, "", { fallbackToDefault: false })
    .filter((material) => material.custom)
    .sort((a, b) => {
      const byCategory = RECIPE_MATERIAL_CATEGORIES.findIndex((category) => category.id === recipeMaterialCategory(a))
        - RECIPE_MATERIAL_CATEGORIES.findIndex((category) => category.id === recipeMaterialCategory(b));
      return byCategory || a.label.localeCompare(b.label, "zh-CN");
    });
}

function mergeRecipeMaterialLibrary(current, additions) {
  const library = new Map(normalizeRecipeMaterialLibrary(current).map((material) => [material.id, material]));
  normalizeRecipeMaterialLibrary(additions).forEach((material) => {
    library.set(material.id, material);
  });
  return Array.from(library.values()).sort((a, b) => a.label.localeCompare(b.label, "zh-CN"));
}

function recipeMaterialOptions(library = [], selected = [], disabledIds = []) {
  const options = new Map();
  const disabled = new Set(normalizeDisabledRecipeMaterialIds(disabledIds));
  BUILTIN_RECIPE_MATERIALS
    .filter((material) => !disabled.has(material.id))
    .forEach((material) => options.set(material.id, { ...material, custom: false }));
  normalizeRecipeMaterialLibrary(library).forEach((material) => options.set(material.id, material));
  normalizeRecipeMaterials(selected, "", { fallbackToDefault: false }).forEach((material) => {
    options.set(material.id, material);
  });
  return Array.from(options.values());
}

function updateRecipeMaterialLibraryFromParams(content, params) {
  const additions = normalizeRecipeMaterials([], params.get("customRecipeMaterials"), {
    fallbackToDefault: false,
    customCategory: params.get("customRecipeMaterialCategory")
  });
  content.recipeMaterialLibrary = mergeRecipeMaterialLibrary(content.recipeMaterialLibrary, additions);
}

function allManagedRecipeMaterials(content) {
  const custom = mergeRecipeMaterialLibrary(content.recipeMaterialLibrary, getTestBlocks(content).flatMap((block) => block.recipeMaterials || []));
  return [
    ...BUILTIN_RECIPE_MATERIALS.map((material) => ({ ...material, custom: false })),
    ...custom
  ];
}

function defaultRecipeMaterialsForContent(content) {
  const disabled = new Set(normalizeDisabledRecipeMaterialIds(content.disabledRecipeMaterialIds));
  return templateRecipeMaterials("withAccelerator")
    .filter((material) => !disabled.has(material.id));
}

function normalizeAgeResults(record, ages = [], metrics = []) {
  const source = record && typeof record === "object" ? record : {};
  const rawResults = source.results && typeof source.results === "object" ? source.results : {};
  const ageList = normalizeAges(ages).length ? normalizeAges(ages) : Object.keys(rawResults).map((age) => Number.parseInt(age, 10)).filter(Number.isInteger);
  const resultMetrics = normalizeResultMetrics(metrics, "", { fallbackToDefault: true });
  const results = {};
  ageList.forEach((age) => {
    const key = String(age);
    const item = rawResults[key] && typeof rawResults[key] === "object" ? rawResults[key] : {};
    const useLegacy = !rawResults[key] && (age === 28 || ageList.length === 1);
    const legacyValues = {
      compressionStrength: item.compressionStrength || (useLegacy ? source.compressionStrength : ""),
      flexuralStrength: item.flexuralStrength || (useLegacy ? source.flexuralStrength : ""),
      splitTensileStrength: item.splitTensileStrength || (useLegacy ? source.splitTensileStrength : ""),
      elasticModulus: item.elasticModulus || (useLegacy ? source.elasticModulus : ""),
      impermeability: item.impermeability || (useLegacy ? source.impermeability : ""),
      mass: item.mass || (useLegacy ? source.mass : ""),
      failureMode: item.failureMode || (useLegacy ? source.failureMode : "")
    };
    const metricValues = normalizeMetricValues(item.metrics, resultMetrics, legacyValues);
    const metricResultSource = item.metricResults && typeof item.metricResults === "object" ? item.metricResults : {};
    const metricResults = {};
    resultMetrics.forEach((metric) => {
      const metricEntry = metricResultSource[metric.id] || {};
      const normalizedEntry = normalizeMetricResultEntry(metricEntry, metricValues[metric.id], {
        age,
        metric: metric.id,
        dueDate: item.dueDate || ""
      });
      metricResults[metric.id] = normalizedEntry;
      metricValues[metric.id] = normalizedEntry.mean || normalizedEntry.manualMean || metricValues[metric.id] || "";
    });
    results[key] = {
      testDate: optionalDateValue(item.testDate || (useLegacy ? source.testDate : "")),
      dueDate: optionalDateValue(item.dueDate || ""),
      compressionStrength: metricValues.compressionStrength || String(legacyValues.compressionStrength || "").trim(),
      flexuralStrength: metricValues.flexuralStrength || String(legacyValues.flexuralStrength || "").trim(),
      resultNote: String(item.resultNote || (useLegacy ? source.resultNote : "") || "").trim(),
      metrics: metricValues,
      metricResults
    };
  });
  return results;
}

function normalizeBlockRecord(value, ages = [], metrics = [], recipeMaterials = []) {
  const record = value && typeof value === "object" ? value : {};
  const metricSource = Array.isArray(metrics) && metrics.length ? metrics : record.metrics;
  const resultMetrics = normalizeResultMetrics(metricSource, "", { fallbackToDefault: true });
  const recipeMaterialSource = Array.isArray(recipeMaterials) && recipeMaterials.length ? recipeMaterials : (record.recipeMaterials || record.materials);
  const normalizedRecipeMaterials = normalizeRecipeMaterials(recipeMaterialSource, "", { fallbackToDefault: true });
  const legacyRecipeValues = {};
  BUILTIN_RECIPE_MATERIALS.forEach((material) => {
    legacyRecipeValues[material.id] = String(record[material.id] || "").trim();
    if (legacyRecipeValues[material.id] && !normalizedRecipeMaterials.some((item) => item.id === material.id)) {
      normalizedRecipeMaterials.push({ ...material, custom: false });
    }
  });
  const recipeValues = normalizeRecipeValues(record.recipeValues || record.materialValues, normalizedRecipeMaterials, legacyRecipeValues);
  return {
    mixName: String(record.mixName || record.recipe || "").trim(),
    cement: recipeValues.cement || String(record.cement || "").trim(),
    water: recipeValues.water || String(record.water || "").trim(),
    sand: recipeValues.sand || String(record.sand || "").trim(),
    stone: recipeValues.stone || String(record.stone || "").trim(),
    admixture: recipeValues.admixture || String(record.admixture || "").trim(),
    flyAsh: recipeValues.flyAsh || String(record.flyAsh || "").trim(),
    mineralPowder: recipeValues.mineralPowder || String(record.mineralPowder || "").trim(),
    otherMaterials: String(record.otherMaterials || "").trim(),
    waterBinderRatio: String(record.waterBinderRatio || "").trim(),
    slump: String(record.slump || "").trim(),
    gradationCoefficient: String(record.gradationCoefficient || record.gradation || record.grading || "").trim(),
    weighingTemplate: String(record.weighingTemplate || "").trim(),
    totalWithoutWater: String(record.totalWithoutWater || "").trim(),
    gradationTemplate: normalizeGradationTemplate(record.gradationTemplate),
    gradationWeights: record.gradationWeights && typeof record.gradationWeights === "object" ? record.gradationWeights : {},
    gangueAggregateId: String(record.gangueAggregateId || record.coalGangueId || "").trim(),
    gangueAggregateName: String(record.gangueAggregateName || record.coalGangueName || "").trim(),
    recipeNote: String(record.recipeNote || "").trim(),
    compressionStrength: String(record.compressionStrength || "").trim(),
    flexuralStrength: String(record.flexuralStrength || "").trim(),
    testDate: optionalDateValue(record.testDate),
    resultNote: String(record.resultNote || "").trim(),
    recipeMaterials: normalizedRecipeMaterials,
    recipeValues,
    metrics: resultMetrics,
    results: normalizeAgeResults(record, ages, resultMetrics)
  };
}

function slugify(value, fallback) {
  const ascii = String(value || "")
    .normalize("NFKD")
    .replace(/[^\w\s.-]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[\s_.]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  if (ascii) return ascii.slice(0, 72);
  const hash = crypto.createHash("sha1").update(String(value || fallback)).digest("hex").slice(0, 8);
  return `${fallback}-${hash}`;
}

function noteSlug(item, index) {
  return slugify(`${item.date || ""}-${item.title || ""}`, `note-${index + 1}`);
}

function imageSlug(item, index) {
  const fileBase = path.basename(item.src || "", path.extname(item.src || ""));
  return slugify(fileBase || item.title, `photo-${index + 1}`);
}

function normalizeLabImageKind(value) {
  const id = String(value || "").trim();
  return LAB_IMAGE_KINDS.some((item) => item.id === id) ? id : "other";
}

function labImageKindLabel(value) {
  return LAB_IMAGE_KINDS.find((item) => item.id === normalizeLabImageKind(value))?.label || "其他实验图";
}

function labImageKindsForTarget(targetType) {
  const ids = targetType === "gangue" ? GANGUE_LAB_IMAGE_KIND_IDS : BLOCK_LAB_IMAGE_KIND_IDS;
  return ids.map((id) => LAB_IMAGE_KINDS.find((item) => item.id === id)).filter(Boolean);
}

function normalizeLabImages(value) {
  return (Array.isArray(value) ? value : [])
    .map((item) => ({
      src: String(item.src || "").trim(),
      title: String(item.title || "").trim(),
      caption: String(item.caption || "").trim(),
      kind: normalizeLabImageKind(item.kind || item.type),
      createdAt: String(item.createdAt || item.date || "").trim()
    }))
    .filter((item) => item.src);
}

function albumSlug(name) {
  return slugify(name || DEFAULT_ALBUM, "album");
}

async function ensureDirs() {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  await fsp.mkdir(BACKUP_DIR, { recursive: true });
  await fsp.mkdir(WORK_UPLOAD_DIR, { recursive: true });
  await fsp.mkdir(UPLOAD_DIR, { recursive: true });
  await fsp.mkdir(PUBLIC_THUMB_DIR, { recursive: true });
  await fsp.mkdir(PRIVATE_UPLOAD_DIR, { recursive: true });
  await fsp.mkdir(PRIVATE_THUMB_DIR, { recursive: true });
}

async function ensureSessionSecret() {
  if (sessionSecret) return sessionSecret;
  await fsp.mkdir(DATA_DIR, { recursive: true });
  try {
    sessionSecret = (await fsp.readFile(SESSION_SECRET_FILE, "utf8")).trim();
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    sessionSecret = crypto.randomBytes(48).toString("base64url");
    await fsp.writeFile(SESSION_SECRET_FILE, `${sessionSecret}\n`, { mode: 0o600 });
  }
  if (!sessionSecret) {
    sessionSecret = crypto.randomBytes(48).toString("base64url");
    await fsp.writeFile(SESSION_SECRET_FILE, `${sessionSecret}\n`, { mode: 0o600 });
  }
  return sessionSecret;
}

async function readContent() {
  try {
    const raw = await fsp.readFile(CONTENT_FILE, "utf8");
    return normalizeContent(JSON.parse(raw));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return structuredClone(defaultContent);
  }
}

function normalizeContent(input) {
  const content = { ...defaultContent, ...(input || {}) };
  content.notes = Array.isArray(content.notes) ? content.notes : [];
  content.ideas = Array.isArray(content.ideas) ? content.ideas : [];
  content.gallery = Array.isArray(content.gallery)
    ? content.gallery.map((item) => ({
      src: String(item.src || "").trim(),
      thumb: String(item.thumb || "").trim(),
      title: String(item.title || "").trim(),
      caption: String(item.caption || "").trim(),
      album: String(item.album || DEFAULT_ALBUM).trim() || DEFAULT_ALBUM,
      private: item.private === true || item.private === "true" || item.private === "1" || item.isPrivate === true
    })).filter((item) => item.src)
    : [];
  content.recipeMaterialLibrary = normalizeRecipeMaterialLibrary(content.recipeMaterialLibrary);
  content.disabledRecipeMaterialIds = normalizeDisabledRecipeMaterialIds(content.disabledRecipeMaterialIds);
  content.dismissedAnomalies = normalizeDismissedAnomalyIds(content.dismissedAnomalies);
  content.coalGangueDb = normalizeCoalGangueDb(content.coalGangueDb);
  content.testBlocks = Array.isArray(content.testBlocks)
    ? content.testBlocks.map((item) => {
      const ages = normalizeAges(item.ages).length ? normalizeAges(item.ages) : [28];
      const metrics = normalizeResultMetrics(item.metrics || (item.record && item.record.metrics), "", { fallbackToDefault: true });
      const recipeMaterials = normalizeRecipeMaterials(item.recipeMaterials || (item.record && item.record.recipeMaterials), "", { fallbackToDefault: true });
      const blockCategory = inferBlockCategoryV3({ ...item, ages, metrics, recipeMaterials });
      return {
        id: String(item.id || crypto.randomUUID()),
        name: String(item.name || item.part || "未命名试块").trim() || "未命名试块",
        blockCategory,
        madeDate: normalizeDateValue(item.madeDate || item.date),
        quantity: Math.max(1, Number.parseInt(item.quantity, 10) || 1),
        ages,
        metrics,
        recipeMaterials,
        demoldDate: normalizeDateValue(item.demoldDate || addDays(item.madeDate || item.date, 1)),
        completed: normalizeCompleted(item.completed, ages),
        record: normalizeBlockRecord(item.record, ages, metrics, recipeMaterials),
        images: normalizeLabImages(item.images || (item.record && item.record.images)),
        strength: String(item.strength || "").trim(),
        note: String(item.note || "").trim()
      };
    }).filter((item) => item.name && item.madeDate)
    : [];
  return content;
}

async function cleanupBackups(label) {
  if (!Number.isFinite(BACKUP_KEEP) || BACKUP_KEEP < 1) return;
  let entries;
  try {
    entries = await fsp.readdir(BACKUP_DIR, { withFileTypes: true });
  } catch {
    return;
  }
  const prefix = `${label}-`;
  const files = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.startsWith(prefix)) continue;
    const filePath = path.join(BACKUP_DIR, entry.name);
    try {
      const stat = await fsp.stat(filePath);
      files.push({ filePath, mtime: stat.mtimeMs });
    } catch {
      // Ignore files that disappear during cleanup.
    }
  }
  files.sort((a, b) => b.mtime - a.mtime);
  await Promise.all(files.slice(BACKUP_KEEP).map((file) => fsp.rm(file.filePath, { force: true }).catch(() => {})));
}

async function backupIfExists(filePath, label) {
  try {
    await fsp.access(filePath);
  } catch {
    return;
  }
  await fsp.copyFile(filePath, path.join(BACKUP_DIR, `${label}-${stamp()}${path.extname(filePath) || ".bak"}`));
  await cleanupBackups(label);
}

async function writeAtomic(filePath, data) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await fsp.writeFile(temp, data);
  await fsp.rename(temp, filePath);
}

async function pathExists(filePath) {
  try {
    await fsp.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function runFile(command, args) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function thumbnailInfo(src) {
  const cleanSrc = String(src || "").trim();
  if (cleanSrc.startsWith(`${PUBLIC_UPLOAD_PATH}/`)) {
    const base = path.basename(cleanSrc, path.extname(cleanSrc));
    return {
      sourcePath: path.join(UPLOAD_DIR, path.basename(cleanSrc)),
      thumbPath: path.join(PUBLIC_THUMB_DIR, `${base}.jpg`),
      thumbSrc: `${PUBLIC_THUMB_PATH}/${base}.jpg`
    };
  }
  if (cleanSrc.startsWith(`${PRIVATE_UPLOAD_PATH}/`)) {
    const base = path.basename(cleanSrc, path.extname(cleanSrc));
    return {
      sourcePath: path.join(PRIVATE_UPLOAD_DIR, path.basename(cleanSrc)),
      thumbPath: path.join(PRIVATE_THUMB_DIR, `${base}.jpg`),
      thumbSrc: `${PRIVATE_THUMB_PATH}/${base}.jpg`
    };
  }
  return null;
}

function imagePreviewSrc(item) {
  return item.thumb || item.src;
}

async function createThumbnail(sourcePath, thumbPath) {
  await fsp.mkdir(path.dirname(thumbPath), { recursive: true });
  const temp = `${thumbPath}.tmp-${process.pid}-${Date.now()}.jpg`;
  try {
    await runFile("ffmpeg", [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      sourcePath,
      "-vf",
      `scale=${THUMB_WIDTH}:-2:force_original_aspect_ratio=decrease`,
      "-frames:v",
      "1",
      "-q:v",
      "5",
      temp
    ]);
    await fsp.rename(temp, thumbPath);
  } catch (error) {
    await fsp.rm(temp, { force: true }).catch(() => {});
    throw error;
  }
}

async function ensureThumbnails(content) {
  for (const item of content.gallery || []) {
    const info = thumbnailInfo(item.src);
    if (!info) continue;
    item.thumb = info.thumbSrc;
    try {
      if (!(await pathExists(info.sourcePath))) continue;
      if (!(await pathExists(info.thumbPath))) {
        await createThumbnail(info.sourcePath, info.thumbPath);
      }
    } catch (error) {
      console.error("thumbnail generation failed", item.src, error.message || error);
      item.thumb = item.src;
    }
  }
}

async function saveContent(content) {
  const normalized = normalizeContent(content);
  normalized.updatedAt = today();
  await ensureDirs();
  await ensureThumbnails(normalized);
  await backupIfExists(CONTENT_FILE, "content");
  await backupIfExists(path.join(SITE_DIR, "index.html"), "index");
  await writeAtomic(CONTENT_FILE, `${JSON.stringify(normalized, null, 2)}\n`);
  await generateSite(normalized);
}

async function generateSite(content) {
  await fsp.rm(path.join(SITE_DIR, "notes"), { recursive: true, force: true });
  await fsp.rm(path.join(SITE_DIR, "gallery"), { recursive: true, force: true });
  await fsp.rm(path.join(SITE_DIR, PRIVATE_GALLERY_PATH.slice(1)), { recursive: true, force: true });
  await writeAtomic(path.join(SITE_DIR, "index.html"), renderHome(content));
  await writeAtomic(path.join(SITE_DIR, "notes", "index.html"), renderNotesIndex(content));
  await writeAtomic(path.join(SITE_DIR, "gallery", "index.html"), renderGalleryIndex(content));
  await writeAtomic(path.join(SITE_DIR, PRIVATE_GALLERY_PATH.slice(1), "index.html"), renderPrivateGalleryPlaceholder(content));

  const notes = getNotes(content);
  await Promise.all(notes.map((item, index) => {
    const slug = noteSlug(item, index);
    return Promise.all([
      writeAtomic(path.join(SITE_DIR, "notes", slug, "index.html"), renderNotePage(content, item, index)),
      writeAtomic(path.join(SITE_DIR, "notes", slug, "note.txt"), renderNoteText(content, item))
    ]);
  }));

  const albums = getAlbums(content);
  await Promise.all(albums.map((album) => Promise.all([
    writeAtomic(path.join(SITE_DIR, "gallery", album.slug, "index.html"), renderAlbumPage(content, album)),
    ...album.items.flatMap((item) => {
      const slug = imageSlug(item, item.index);
      const writes = [
        writeAtomic(path.join(SITE_DIR, "gallery", album.slug, slug, "index.html"), renderPhotoPage(content, album, item))
      ];
      if (slug !== album.slug) {
        writes.push(writeAtomic(path.join(SITE_DIR, "gallery", slug, "index.html"), renderPhotoPage(content, album, item)));
      }
      return writes;
    })
  ])));

  await fsp.rm(path.join(SITE_DIR, PRIVATE_GALLERY_PATH.slice(1)), { recursive: true, force: true });
  await writeAtomic(path.join(SITE_DIR, PRIVATE_GALLERY_PATH.slice(1), "index.html"), renderPrivateGalleryPlaceholder(content));
}

function getNotes(content) {
  return content.notes.filter((item) => item.title || item.body || item.date);
}

function getIdeas(content) {
  return content.ideas.filter((item) => item.title || item.body || item.tag);
}

function getGallery(content, options = {}) {
  const wantPrivate = options.private === true;
  return content.gallery.filter((item) => item.src && Boolean(item.private) === wantPrivate);
}

function getAlbums(content, options = {}) {
  const groups = [];
  const byName = new Map();
  getGallery(content, options).forEach((item, index) => {
    const name = String(item.album || DEFAULT_ALBUM).trim() || DEFAULT_ALBUM;
    if (!byName.has(name)) {
      const group = { name, slug: albumSlug(name), items: [] };
      byName.set(name, group);
      groups.push(group);
    }
    const group = byName.get(name);
    group.items.push({ ...item, index, albumIndex: group.items.length });
  });

  const used = new Map();
  groups.forEach((group) => {
    const base = group.slug;
    let suffix = 2;
    while (used.has(group.slug) && used.get(group.slug) !== group.name) {
      group.slug = `${base}-${suffix}`;
      suffix += 1;
    }
    used.set(group.slug, group.name);
  });

  return groups.map((group) => ({
    ...group,
    private: options.private === true,
    cover: group.items[0],
    count: group.items.length
  }));
}

function addDays(dateText, days) {
  const [year, month, day] = normalizeDateValue(dateText).split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + Number(days));
  return date.toISOString().slice(0, 10);
}

function getTestBlocks(content) {
  return Array.isArray(content.testBlocks) ? content.testBlocks : [];
}

function splitParticleRanges(value) {
  return String(value || "")
    .split(/[\n,，、;；]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 24);
}

function defaultParticleRanges() {
  return ["0.3-0.6", "0.6-1.18", "1.18-2.36", "2.36-4.75"];
}

function parseMeasurementNumber(value) {
  const match = String(value || "").replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const number = Number.parseFloat(match[0]);
  return Number.isFinite(number) ? number : null;
}

function averageMeasurement(values) {
  const numbers = values.map(parseMeasurementNumber).filter((value) => value !== null);
  if (!numbers.length) return null;
  return numbers.reduce((total, value) => total + value, 0) / numbers.length;
}

function measurementSuffix(values, fallback = "%") {
  return values.some((value) => /%|％/.test(String(value || ""))) ? "%" : fallback;
}

function formatMeasurementAverage(values) {
  const average = averageMeasurement(values);
  if (average === null) return "";
  return `${formatRecipeNumber(average, 2)}${measurementSuffix(values)}`;
}

function calculateGangueCrushingSummary(item) {
  const ranges = item.particleRanges && item.particleRanges.length ? item.particleRanges : defaultParticleRanges();
  const rows = ranges.map((range) => {
    const tests = item.crushingTests?.[range] || [];
    const average = averageMeasurement(tests);
    return { range, average, text: average === null ? "" : `${formatRecipeNumber(average, 2)}${measurementSuffix(tests)}` };
  }).filter((row) => row.average !== null);
  if (!rows.length) return { range: "", value: "", average: null };
  rows.sort((a, b) => b.average - a.average);
  return rows[0];
}

function normalizeGangueGradations(value, ranges = []) {
  return (Array.isArray(value) ? value : [])
    .map((item) => {
      const rawWeights = item.particleWeights && typeof item.particleWeights === "object"
        ? item.particleWeights
        : (item.weights && typeof item.weights === "object" ? item.weights : {});
      const weightRanges = ranges.length ? ranges : Object.keys(rawWeights);
      const particleWeights = {};
      weightRanges.forEach((range) => {
        particleWeights[range] = String(rawWeights[range] || "").trim();
      });
      return {
        name: String(item.name || item.gradationName || "").trim(),
        nValue: String(item.nValue || item.n || "").trim(),
        looseBulkDensity: String(item.looseBulkDensity || item.looseDensity || "").trim(),
        compactedBulkDensity: String(item.compactedBulkDensity || item.compactedDensity || "").trim(),
        particleWeights,
        note: String(item.note || "").trim()
      };
    })
    .filter((item) => (
      item.name || item.nValue || item.looseBulkDensity || item.compactedBulkDensity || item.note
      || Object.values(item.particleWeights).some(Boolean)
    ));
}

function normalizeCoalGangueItem(item = {}) {
  const ranges = splitParticleRanges(item.particleRanges || item.ranges).length
    ? splitParticleRanges(item.particleRanges || item.ranges)
    : defaultParticleRanges();
  const crushingSource = item.crushingValues && typeof item.crushingValues === "object" ? item.crushingValues : {};
  const crushingTestSource = item.crushingTests && typeof item.crushingTests === "object" ? item.crushingTests : {};
  const flakySource = item.flakinessValues && typeof item.flakinessValues === "object" ? item.flakinessValues : {};
  const crushingValues = {};
  const crushingTests = {};
  const flakinessValues = {};
  ranges.forEach((range) => {
    const legacyValue = String(crushingSource[range] || "").trim();
    const tests = Array.isArray(crushingTestSource[range]) ? crushingTestSource[range] : [];
    crushingTests[range] = [0, 1, 2].map((index) => String(tests[index] ?? (index === 0 ? legacyValue : "") ?? "").trim());
    crushingValues[range] = formatMeasurementAverage(crushingTests[range]) || legacyValue;
    flakinessValues[range] = String(flakySource[range] || "").trim();
  });
  const summary = calculateGangueCrushingSummary({ particleRanges: ranges, crushingTests });
  return {
    id: String(item.id || crypto.randomUUID()),
    name: String(item.name || "未命名煤矸石").trim() || "未命名煤矸石",
    source: String(item.source || item.origin || "").trim(),
    particleRanges: ranges,
    crushingValues,
    crushingTests,
    batchCrushingRange: summary.range,
    batchCrushingValue: summary.text || String(item.batchCrushingValue || "").trim(),
    flakinessValues,
    coarseWaterAbsorption: String(item.coarseWaterAbsorption || "").trim(),
    fineWaterAbsorption: String(item.fineWaterAbsorption || "").trim(),
    coarseApparentDensity: String(item.coarseApparentDensity || "").trim(),
    fineApparentDensity: String(item.fineApparentDensity || "").trim(),
    gradations: normalizeGangueGradations(item.gradations, ranges),
    images: normalizeLabImages(item.images),
    otherInfo: String(item.otherInfo || item.note || "").trim(),
    updatedAt: String(item.updatedAt || today()).trim()
  };
}

function normalizeCoalGangueDb(value) {
  return (Array.isArray(value) ? value : [])
    .map((item) => normalizeCoalGangueItem(item))
    .filter((item) => item.name)
    .sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
}

function getCoalGangueDb(content) {
  return normalizeCoalGangueDb(content.coalGangueDb);
}

function coalGangueNameById(content, id) {
  return getCoalGangueDb(content).find((item) => item.id === id)?.name || "";
}

function taskCompleted(block, type, age = "") {
  if (type === "demold") return block.completed?.demold === true;
  if (type === "age") return block.completed?.ages?.[String(age)] === true;
  return false;
}

function taskDeleted(block, type, age = "") {
  if (type === "demold") return block.completed?.deleted?.demold === true;
  if (type === "age") return block.completed?.deleted?.ages?.[String(age)] === true;
  return false;
}

function getBlockDueItems(content) {
  return getTestBlocks(content).flatMap((block) => block.ages.map((age) => ({
    type: "age",
    block,
    age,
    date: addDays(block.madeDate, age),
    completed: taskCompleted(block, "age", age)
  })).filter((item) => !taskDeleted(item.block, "age", item.age))).sort((a, b) => a.date.localeCompare(b.date) || a.block.name.localeCompare(b.block.name));
}

function getDemoldDueItems(content) {
  return getTestBlocks(content).map((block) => ({
  type: "demold",
  block,
  date: normalizeDateValue(block.demoldDate || addDays(block.madeDate, 1)),
  completed: taskCompleted(block, "demold")
})).filter((item) => !taskDeleted(item.block, "demold")).sort((a, b) => a.date.localeCompare(b.date) || a.block.name.localeCompare(b.block.name));
}

function getCalendarItems(content) {
  return [...getDemoldDueItems(content), ...getBlockDueItems(content)]
    .sort((a, b) => a.date.localeCompare(b.date) || a.block.name.localeCompare(b.block.name) || a.type.localeCompare(b.type));
}

function getReminderItems(content, type) {
  return getCalendarItems(content).filter((item) => item.type === type && !item.completed);
}

function splitReminderItems(items, referenceDate = today()) {
  const upcomingEnd = addDays(referenceDate, 7);
  return {
    overdue: items.filter((item) => item.date < referenceDate),
    today: items.filter((item) => item.date === referenceDate),
    upcoming: items.filter((item) => item.date > referenceDate && item.date <= upcomingEnd)
  };
}

function activeMailItems(content, referenceDate = today()) {
  return getCalendarItems(content).filter((item) => item.date <= referenceDate && !item.completed);
}

function shiftMonth(monthKey, offset) {
  const [year, month] = monthKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1 + offset, 1));
  return date.toISOString().slice(0, 7);
}

function monthRange(startKey, endKey, limit = 12) {
  const months = [];
  let current = startKey;
  while (current <= endKey && months.length < limit) {
    months.push(current);
    current = shiftMonth(current, 1);
  }
  return months;
}

function calendarMonths(dueItems) {
  const current = today().slice(0, 7);
  const futureMonths = dueItems
    .map((item) => item.date.slice(0, 7))
    .filter((month) => month >= current);
  const end = futureMonths.length ? futureMonths.reduce((max, month) => (month > max ? month : max), current) : shiftMonth(current, 2);
  return monthRange(current, end);
}

function formatDateCn(dateText) {
  const date = normalizeDateValue(dateText);
  const [year, month, day] = date.split("-");
  return `${year}-${month}-${day}`;
}

function formatMonthCn(monthKey) {
  const [year, month] = monthKey.split("-");
  return `${year}年${Number(month)}月`;
}

function pageHead(content, title, description = "") {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="${attr(description || `${content.siteTitle}，一个安静整理笔记、想法和图片的地方。`)}">
  <title>${html(title)}</title>
  <link rel="stylesheet" href="/styles.css">
</head>`;
}

function publicHeader(content) {
  return `<header class="site-header">
    <nav class="nav" aria-label="主导航">
      <a class="brand" href="/" aria-label="${attr(content.brandName)}首页">
        <span class="brand-mark" aria-hidden="true"></span>
        <span>${html(content.brandName)}</span>
      </a>
      <div class="nav-links" aria-label="页面章节">
        <a href="/notes/">笔记</a>
        <a href="/gallery/">相册</a>
        <a href="${PRIVATE_GALLERY_PATH}/">私密相册</a>
        <a href="${WORK_PATH}/">工作区</a>
        <a href="/#ideas">项目</a>
        <a href="/#about">关于</a>
      </div>
    </nav>
  </header>`;
}

function publicFooter(content) {
  return `<footer class="footer">
    <p>© ${new Date().getFullYear()} ${html(content.footerName)}</p>
    <p>最后更新：${html(content.updatedAt)}</p>
  </footer>`;
}

function renderHome(content) {
  const notes = getNotes(content);
  const ideas = getIdeas(content);
  const albums = getAlbums(content);
  const heroPhotos = getGallery(content).slice(0, 3);

  return `${pageHead(content, content.siteTitle)}
<body>
  ${publicHeader(content)}
  <main>
    <section class="hero" aria-labelledby="hero-title">
      <div class="hero-media photo-stack" aria-label="相册预览">
        ${heroPhotos.length ? heroPhotos.map((item, index) => `<figure class="hero-photo hero-photo-${index + 1}">
          <img src="${attr(imagePreviewSrc(item))}" alt="${attr(item.title || "相册照片")}" loading="${index ? "lazy" : "eager"}">
        </figure>`).join("\n        ") : `<div class="hero-empty">
          <span>xx520</span>
          <strong>写点东西，留点照片。</strong>
        </div>`}
        <div class="hero-status" aria-hidden="true">
          <span>站点在线</span>
          <strong>${notes.length} 篇笔记 · ${albums.reduce((total, album) => total + album.count, 0)} 张照片</strong>
        </div>
      </div>
      <div class="hero-copy">
        <p class="eyebrow">${html(content.eyebrow)}</p>
        <h1 id="hero-title">${html(content.heroTitle)}</h1>
        <p class="lead">${html(content.lead)}</p>
        <div class="hero-actions">
          <a class="primary-link" href="${WORK_PATH}/">进入工作区</a>
          <a class="ghost-link" href="/notes/">看笔记</a>
        </div>
      </div>
    </section>

    <section class="section intro" id="about" aria-labelledby="about-title">
      <div>
        <p class="section-kicker">${html(content.aboutKicker)}</p>
        <h2 id="about-title">${html(content.aboutTitle)}</h2>
      </div>
      <p>${html(content.aboutBody)}</p>
    </section>

    <section class="section admin-panel" id="workspace" aria-labelledby="workspace-title">
      <div class="section-heading">
        <div>
          <p class="section-kicker">快捷入口</p>
          <h2 id="workspace-title">常用入口放在这里，少绕路。</h2>
        </div>
      </div>
      <div class="admin-grid">
        <a class="admin-card primary" href="${WORK_PATH}/">
          <span class="admin-icon">工</span>
          <strong>工作区</strong>
          <em>试块登记、日历、邮件提醒</em>
        </a>
        <a class="admin-card" href="${PRIVATE_GALLERY_PATH}/">
          <span class="admin-icon">相</span>
          <strong>私密相册</strong>
          <em>查看私密照片和下载原图</em>
        </a>
      </div>
    </section>

    <section class="section" id="notes" aria-labelledby="notes-title">
      <div class="section-heading">
        <div>
          <p class="section-kicker">近期笔记</p>
          <h2 id="notes-title">点进每篇笔记，可以完整阅读和下载文本。</h2>
        </div>
        <a class="text-link" href="/notes/">查看全部笔记</a>
      </div>
      <div class="note-list">
        ${notes.slice(0, 3).map((item, index) => noteCard(item, index)).join("\n        ")}
      </div>
    </section>

    <section class="section gallery-section" id="gallery" aria-labelledby="gallery-title">
      <div class="section-heading">
        <div>
          <p class="section-kicker">相册</p>
          <h2 id="gallery-title">照片按相册整理，点进去查看和下载原图。</h2>
        </div>
        <div class="section-actions">
          <a class="text-link" href="/gallery/">打开相册</a>
          <a class="text-link" href="${PRIVATE_GALLERY_PATH}/">私密相册</a>
          <a class="text-link" href="${WORK_PATH}/">工作区</a>
        </div>
      </div>
      ${albums.length ? `<div class="album-grid">
        ${albums.slice(0, 6).map((album) => albumCard(album)).join("\n        ")}
      </div>` : emptyGallery()}
    </section>

    <section class="section" id="ideas" aria-labelledby="ideas-title">
      <div class="section-heading">
        <p class="section-kicker">项目和想法</p>
        <h2 id="ideas-title">小而实用，慢慢迭代。</h2>
      </div>
      <div class="idea-grid">
        ${ideas.map((item) => `<article class="idea-card">
          <span class="tag">${html(item.tag)}</span>
          <h3>${html(item.title)}</h3>
          <p>${html(item.body)}</p>
        </article>`).join("\n        ")}
      </div>
    </section>
  </main>
  ${publicFooter(content)}
</body>
</html>
`;
}

function noteCard(item, index) {
  const href = `/notes/${noteSlug(item, index)}/`;
  return `<article class="note-card${index === 0 ? " featured" : ""}">
          <p class="date">${html(item.date || "待更新")}</p>
          <h3><a href="${href}">${html(item.title)}</a></h3>
          <p>${html(item.body)}</p>
          <a class="card-link" href="${href}">阅读全文</a>
        </article>`;
}

function galleryBasePath(privateMode = false) {
  return privateMode ? PRIVATE_GALLERY_PATH : "/gallery";
}

function albumCard(album, privateMode = false) {
  const href = `${galleryBasePath(privateMode)}/${album.slug}/`;
  const cover = album.cover || {};
  const summary = album.items
    .slice(0, 3)
    .map((item) => item.caption || item.title)
    .filter(Boolean)
    .join(" / ");
  return `<article class="album-card">
          <a class="album-cover" href="${href}"><img src="${attr(imagePreviewSrc(cover))}" alt="${attr(album.name)}" loading="lazy"></a>
          <div class="album-body">
            <p class="album-meta">${album.count} 张照片</p>
            <h3><a href="${href}">${html(album.name)}</a></h3>
            <p>${html(summary || "这个相册还没有说明。")}</p>
            <a class="card-link" href="${href}">打开相册</a>
          </div>
        </article>`;
}

function galleryCard(item, index, album) {
  const itemIndex = Number.isInteger(item.index) ? item.index : index;
  const href = album ? `/gallery/${album.slug}/${imageSlug(item, itemIndex)}/` : `/gallery/${imageSlug(item, itemIndex)}/`;
  return `<figure class="gallery-card">
          <a href="${href}"><img src="${attr(imagePreviewSrc(item))}" alt="${attr(item.title || "相册图片")}" loading="lazy"></a>
          <figcaption>
            <strong><a href="${href}">${html(item.title || "未命名图片")}</a></strong>
            <span>${html(item.caption || "")}</span>
          </figcaption>
        </figure>`;
}

function photoTile(item, album) {
  const href = `${galleryBasePath(album.private)}/${album.slug}/${imageSlug(item, item.index)}/`;
  return `<figure class="photo-tile">
          <a class="photo-tile-image" href="${href}" data-lightbox-index="${item.albumIndex || 0}"><img src="${attr(imagePreviewSrc(item))}" alt="${attr(item.title || "相册图片")}" loading="lazy"></a>
          <figcaption>
            <strong><a href="${href}">${html(item.title || "未命名图片")}</a></strong>
            ${item.caption ? `<span>${html(item.caption)}</span>` : ""}
            <div class="photo-links">
              <a href="${href}">详情</a>
              <a href="${attr(item.src)}" download>下载</a>
            </div>
          </figcaption>
        </figure>`;
}

function renderLightbox(album) {
  const photos = album.items.map((item) => ({
    src: item.src,
    title: item.title || "未命名图片",
    caption: item.caption || ""
  }));
  return `<div class="lightbox" data-lightbox hidden>
        <button class="lightbox-close" type="button" data-lightbox-close aria-label="退出看图">退出</button>
        <button class="lightbox-nav prev" type="button" data-lightbox-prev aria-label="上一张">&lsaquo;</button>
        <figure class="lightbox-panel">
          <img data-lightbox-image alt="">
          <figcaption>
            <strong data-lightbox-title></strong>
            <p data-lightbox-caption></p>
            <div class="photo-links">
              <a data-lightbox-download download>下载原图</a>
            </div>
          </figcaption>
        </figure>
        <button class="lightbox-nav next" type="button" data-lightbox-next aria-label="下一张">&rsaquo;</button>
      </div>
      <script>
        (() => {
          const photos = ${scriptJson(photos)};
          const overlay = document.querySelector("[data-lightbox]");
          if (!overlay || !photos.length) return;
          const image = overlay.querySelector("[data-lightbox-image]");
          const title = overlay.querySelector("[data-lightbox-title]");
          const caption = overlay.querySelector("[data-lightbox-caption]");
          const download = overlay.querySelector("[data-lightbox-download]");
          const closeButton = overlay.querySelector("[data-lightbox-close]");
          let current = 0;

          function openLightbox(index) {
            current = Math.max(0, Math.min(photos.length - 1, index));
            const photo = photos[current];
            image.src = photo.src;
            image.alt = photo.title;
            title.textContent = photo.title;
            caption.textContent = photo.caption || "";
            download.href = photo.src;
            overlay.hidden = false;
            document.body.classList.add("lightbox-open");
            closeButton.focus();
          }

          function closeLightbox() {
            overlay.hidden = true;
            document.body.classList.remove("lightbox-open");
            image.removeAttribute("src");
          }

          function move(step) {
            openLightbox((current + step + photos.length) % photos.length);
          }

          document.querySelectorAll("[data-lightbox-index]").forEach((link) => {
            link.addEventListener("click", (event) => {
              event.preventDefault();
              openLightbox(Number(link.dataset.lightboxIndex || 0));
            });
          });
          closeButton.addEventListener("click", closeLightbox);
          overlay.addEventListener("click", (event) => {
            if (event.target === overlay) closeLightbox();
          });
          overlay.querySelector("[data-lightbox-prev]").addEventListener("click", () => move(-1));
          overlay.querySelector("[data-lightbox-next]").addEventListener("click", () => move(1));
          document.addEventListener("keydown", (event) => {
            if (overlay.hidden) return;
            if (event.key === "Escape") closeLightbox();
            if (event.key === "ArrowLeft") move(-1);
            if (event.key === "ArrowRight") move(1);
          });
        })();
      </script>`;
}

function emptyGallery() {
  return `<div class="empty-gallery">
        <p>还没有上传图片。等你放进第一张照片，这里就会亮起来。</p>
      </div>`;
}

function renderNotesIndex(content) {
  const notes = getNotes(content);
  return `${pageHead(content, `笔记 - ${content.siteTitle}`, "所有公开笔记。")}
<body>
  ${publicHeader(content)}
  <main>
    <section class="page-hero">
      <p class="eyebrow">Notes</p>
      <h1>笔记</h1>
      <p class="lead">这里收着所有可以点进去看的记录，每篇都提供文本下载。</p>
    </section>
    <section class="section">
      <div class="note-list wide-list">
        ${notes.map((item, index) => noteCard(item, index)).join("\n        ")}
      </div>
    </section>
  </main>
  ${publicFooter(content)}
</body>
</html>
`;
}

function renderNotePage(content, item, index) {
  const slug = noteSlug(item, index);
  return `${pageHead(content, `${item.title || "笔记"} - ${content.siteTitle}`, item.body || "")}
<body>
  ${publicHeader(content)}
  <main>
    <article class="detail-page note-detail">
      <nav class="breadcrumb"><a href="/notes/">笔记</a><span>/</span><span>${html(item.title || "未命名笔记")}</span></nav>
      <p class="date">${html(item.date || "待更新")}</p>
      <h1>${html(item.title || "未命名笔记")}</h1>
      <div class="note-body">${paragraphs(item.body)}</div>
      <div class="detail-actions">
        <a class="button-link" href="/notes/${slug}/note.txt" download>下载这篇笔记</a>
        <a class="button-link secondary" href="/notes/">返回笔记列表</a>
      </div>
    </article>
  </main>
  ${publicFooter(content)}
</body>
</html>
`;
}

function renderNoteText(content, item) {
  return `${item.title || "未命名笔记"}\n${item.date || ""}\n\n${item.body || ""}\n\n-- ${content.siteTitle}\n`;
}

function paragraphs(value) {
  const lines = String(value || "").split(/\n{2,}/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return "<p>这篇笔记还没有正文。</p>";
  return lines.map((line) => `<p>${html(line)}</p>`).join("\n        ");
}

function renderGalleryIndex(content) {
  const albums = getAlbums(content);
  return `${pageHead(content, `相册 - ${content.siteTitle}`, "公开相册，可以查看和下载原图。")}
<body>
  ${publicHeader(content)}
  <main>
    <section class="page-hero">
      <p class="eyebrow">Gallery</p>
      <h1>相册</h1>
      <p class="lead">照片会按相册分组。打开一个相册后，可以逐张查看，也可以下载原图。</p>
    </section>
    <section class="section gallery-section">
      ${albums.length ? `<div class="album-grid">
        ${albums.map((album) => albumCard(album)).join("\n        ")}
      </div>` : emptyGallery()}
    </section>
  </main>
  ${publicFooter(content)}
</body>
</html>
`;
}

function renderPrivateGalleryIndex(content) {
  const albums = getAlbums(content, { private: true });
  return `${pageHead(content, `私密相册 - ${content.siteTitle}`, "需要密码访问的私密相册。")}
<body>
  ${publicHeader(content)}
  <main>
    <section class="page-hero">
      <p class="eyebrow">Private Gallery</p>
      <h1>私密相册</h1>
      <p class="lead">这里的相册和原图都需要密码访问。</p>
    </section>
    <section class="section gallery-section">
      ${albums.length ? `<div class="album-grid">
        ${albums.map((album) => albumCard(album, true)).join("\n        ")}
      </div>` : emptyGallery()}
    </section>
  </main>
  ${publicFooter(content)}
</body>
</html>
`;
}

function renderPrivateGalleryPlaceholder(content) {
  return `${pageHead(content, `私密相册 - ${content.siteTitle}`, "需要密码访问的私密相册。")}
<body>
  ${publicHeader(content)}
  <main>
    <section class="page-hero">
      <p class="eyebrow">Private Gallery</p>
      <h1>私密相册</h1>
      <p class="lead">这里的相册和原图需要通过密码验证后查看。</p>
      <div class="hero-actions">
        <a class="primary-link" href="${PRIVATE_GALLERY_PATH}/">进入私密相册</a>
      </div>
    </section>
  </main>
  ${publicFooter(content)}
</body>
</html>
`;
}

function renderAlbumPage(content, album, privateMode = false) {
  return `${pageHead(content, `${album.name} - ${content.siteTitle}`, `${album.name}，共 ${album.count} 张照片。`)}
<body>
  ${publicHeader(content)}
  <main>
    <section class="page-hero">
      <p class="eyebrow">Album</p>
      <h1>${html(album.name)}</h1>
      <p class="lead">共 ${album.count} 张照片。</p>
    </section>
    <section class="section gallery-section album-photos">
      <div class="photo-masonry">
        ${album.items.map((item) => photoTile(item, album)).join("\n        ")}
      </div>
      ${renderLightbox(album)}
    </section>
  </main>
  ${publicFooter(content)}
</body>
</html>
`;
}

function renderPhotoPage(content, album, item, privateMode = false) {
  const base = galleryBasePath(privateMode);
  return `${pageHead(content, `${item.title || "相册图片"} - ${content.siteTitle}`, item.caption || "相册图片详情。")}
<body>
  ${publicHeader(content)}
  <main>
    <article class="detail-page photo-detail">
      <nav class="breadcrumb"><a href="${base}/">${privateMode ? "私密相册" : "相册"}</a><span>/</span><a href="${base}/${album.slug}/">${html(album.name)}</a><span>/</span><span>${html(item.title || "未命名图片")}</span></nav>
      <h1>${html(item.title || "未命名图片")}</h1>
      <p class="lead">${html(item.caption || "这张图片还没有说明。")}</p>
      <div class="photo-frame">
        <img src="${attr(item.src)}" alt="${attr(item.title || "相册图片")}">
      </div>
      <div class="detail-actions">
        <a class="button-link" href="${attr(item.src)}" download>下载原图</a>
        <a class="button-link secondary" href="${base}/${album.slug}/">返回这个相册</a>
      </div>
    </article>
  </main>
  ${publicFooter(content)}
</body>
</html>
`;
}

function renderAdmin(content, message = "") {
  const albums = getAlbums(content);
  const privateAlbums = getAlbums(content, { private: true });
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>编辑 ${html(content.siteTitle)}</title>
  <style>
    :root { --bg:#f7faf8; --surface:#fff; --ink:#1f2b2c; --muted:#607174; --line:#dbe7e2; --green:#4d8a76; --coral:#d87658; }
    * { box-sizing: border-box; }
    body { margin:0; font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; background:var(--bg); color:var(--ink); }
    header { position: sticky; top:0; z-index:2; background:rgba(247,250,248,.92); border-bottom:1px solid var(--line); backdrop-filter: blur(12px); }
    .bar, main { width:min(1080px, calc(100% - 32px)); margin:0 auto; }
    .bar { min-height:64px; display:flex; align-items:center; justify-content:space-between; gap:18px; }
    h1 { margin:0; font-size:22px; }
    a { color:var(--green); text-decoration:none; font-weight:700; }
    main { padding:28px 0 60px; }
    form, section.panel { margin:0 0 18px; padding:22px; background:var(--surface); border:1px solid var(--line); border-radius:8px; box-shadow:0 14px 32px rgba(31,43,44,.06); }
    h2 { margin:0 0 16px; font-size:20px; }
    label { display:block; margin:12px 0 6px; color:var(--muted); font-size:14px; font-weight:700; }
    input, textarea { width:100%; border:1px solid var(--line); border-radius:8px; padding:11px 12px; font:inherit; color:var(--ink); background:#fff; }
    input[type="checkbox"] { width:auto; }
    textarea { min-height:92px; resize:vertical; }
    .check-row { display:flex; align-items:center; gap:10px; margin-top:14px; color:var(--ink); }
    .grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:14px; }
    .item { margin:12px 0; padding:14px; border:1px solid var(--line); border-radius:8px; background:#fbfdfc; }
    .actions { display:flex; flex-wrap:wrap; gap:10px; margin-top:18px; }
    button { border:0; border-radius:8px; padding:10px 14px; font:inherit; font-weight:800; cursor:pointer; background:var(--green); color:#fff; }
    button:disabled { opacity:.62; cursor:not-allowed; }
    button.secondary { background:#edf6f2; color:var(--green); }
    button.danger { background:#fff0ec; color:#a54f39; }
    .message { margin:0 0 18px; padding:12px 14px; border-radius:8px; background:#edf6f2; color:#2f6f5b; font-weight:700; }
    .hint { margin:8px 0 0; color:var(--muted); font-size:13px; }
    .compact-form, .rename-form { box-shadow:none; background:#fbfdfc; }
    .rename-form { display:grid; grid-template-columns:minmax(0,1fr) auto; gap:10px; align-items:end; margin:0 0 12px; padding:12px; }
    .rename-form label { margin:0; }
    .progress { display:none; margin-top:14px; padding:14px; border:1px solid var(--line); border-radius:8px; background:#fbfdfc; }
    .progress.active { display:block; }
    .progress-track { height:10px; overflow:hidden; border-radius:999px; background:#e7f0ec; }
    .progress-bar { width:0%; height:100%; border-radius:999px; background:var(--green); transition:width .18s ease; }
    .progress-row { display:flex; justify-content:space-between; gap:12px; margin-top:10px; color:var(--muted); font-size:13px; }
    .progress-list { margin:10px 0 0; padding-left:18px; color:var(--muted); font-size:13px; }
    .album-block { margin:0 0 22px; }
    .album-block h3 { margin:0 0 10px; font-size:17px; }
    .album-block h3 span { color:var(--muted); font-size:13px; font-weight:600; }
    .calendar-board { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:14px; margin-top:16px; }
    .month-card { border:1px solid var(--line); border-radius:8px; overflow:hidden; background:#fff; }
    .month-card h3 { margin:0; padding:12px 14px; background:#edf6f2; font-size:16px; }
    .weekdays, .calendar-days { display:grid; grid-template-columns:repeat(7,minmax(0,1fr)); }
    .weekdays span { padding:8px 4px; color:var(--muted); text-align:center; font-size:12px; font-weight:800; border-bottom:1px solid var(--line); }
    .day-cell { min-height:82px; padding:6px; border-right:1px solid var(--line); border-bottom:1px solid var(--line); background:#fff; }
    .day-cell:nth-child(7n) { border-right:0; }
    .day-cell.empty { background:#f7faf8; }
    .day-number { display:inline-flex; min-width:24px; height:24px; align-items:center; justify-content:center; border-radius:999px; font-weight:800; font-size:12px; }
    .day-cell.today .day-number { background:var(--green); color:#fff; }
    .due-pill { display:block; margin-top:5px; padding:5px 6px; border-radius:7px; background:#fff7ed; color:#9a4d28; font-size:12px; line-height:1.25; }
    .block-list { display:grid; gap:10px; margin-top:14px; }
    .block-row { display:grid; grid-template-columns:minmax(0,1fr) auto; gap:12px; align-items:center; padding:12px; border:1px solid var(--line); border-radius:8px; background:#fff; }
    .block-row p { margin:4px 0 0; color:var(--muted); font-size:13px; }
    .inline-delete { margin:0; padding:0; border:0; background:transparent; box-shadow:none; }
    .gallery { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:12px; }
    figure { margin:0; border:1px solid var(--line); border-radius:8px; overflow:hidden; background:#fff; }
    img { display:block; width:100%; height:150px; object-fit:cover; }
    figcaption { padding:10px; color:var(--muted); font-size:13px; }
    @media (max-width:760px) { .grid, .gallery, .calendar-board, .rename-form, .block-row { grid-template-columns:1fr; } .bar { align-items:flex-start; flex-direction:column; padding:14px 0; } }
  </style>
</head>
<body>
  <header>
    <div class="bar">
      <h1>编辑 ${html(content.siteTitle)}</h1>
      <div><a href="/" target="_blank" rel="noopener">首页</a> · <a href="/gallery/" target="_blank" rel="noopener">相册</a> · <a href="${PRIVATE_GALLERY_PATH}/" target="_blank" rel="noopener">私密相册</a> · <a href="${WORK_PATH}/" target="_blank" rel="noopener">工作区</a> · <a href="${BASE_PATH}/logout">退出</a></div>
    </div>
  </header>
  <main>
    ${message ? `<p class="message">${html(message)}</p>` : ""}
    <form method="post" action="${BASE_PATH}/save">
      <h2>首页内容</h2>
      <div class="grid">
        ${field("siteTitle", "浏览器标题", content.siteTitle)}
        ${field("brandName", "站点名称", content.brandName)}
      </div>
      ${field("eyebrow", "小字引导", content.eyebrow)}
      ${area("heroTitle", "主标题", content.heroTitle)}
      ${area("lead", "简介", content.lead)}
      <div class="grid">
        ${field("aboutKicker", "关于小标题", content.aboutKicker)}
        ${field("footerName", "页脚名称", content.footerName)}
      </div>
      ${field("aboutTitle", "关于标题", content.aboutTitle)}
      ${area("aboutBody", "关于正文", content.aboutBody)}

      <h2>近期笔记</h2>
      <div id="notes">${content.notes.map((item) => noteFields(item)).join("")}</div>
      <button class="secondary" type="button" onclick="addNote()">添加笔记</button>

      <h2>项目和想法</h2>
      <div id="ideas">${content.ideas.map((item) => ideaFields(item)).join("")}</div>
      <button class="secondary" type="button" onclick="addIdea()">添加项目</button>

      <div class="actions"><button type="submit">保存并发布</button></div>
    </form>

    <form id="upload-form" method="post" action="${BASE_PATH}/upload" enctype="multipart/form-data">
      <h2>上传图片到相册</h2>
      <div class="grid">
        ${field("albumName", "相册名称", DEFAULT_ALBUM)}
        ${field("imageTitle", "图片标题", "")}
      </div>
      <div class="grid">
        ${field("imageCaption", "图片说明", "")}
      </div>
      <label for="image">选择图片，可以一次选择多张</label>
      <input id="image" name="image" type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple required>
      <label class="check-row"><input id="privateAlbum" name="privateAlbum" type="checkbox" value="1"><span>设为私密相册图片</span></label>
      <p class="hint">一次选择多张图片时，它们会进入同一个相册；标题留空时会使用文件名。勾选私密后，页面和原图都需要密码。</p>
      <div id="upload-progress" class="progress" aria-live="polite">
        <div class="progress-track"><div id="upload-bar" class="progress-bar"></div></div>
        <div class="progress-row"><span id="upload-text">准备上传</span><span id="upload-percent">0%</span></div>
        <ol id="upload-list" class="progress-list"></ol>
      </div>
      <div class="actions"><button id="upload-button" type="submit">上传并发布</button></div>
    </form>

    <section class="panel">
      <h2>公开相册图片</h2>
      ${renderAdminAlbums(albums, false)}

      <h2>私密相册图片</h2>
      ${renderAdminAlbums(privateAlbums, true)}
    </section>

  </main>
  <template id="note-template">${noteFields({ date: "待更新", title: "", body: "" })}</template>
  <template id="idea-template">${ideaFields({ tag: "Note", title: "", body: "" })}</template>
  <script>
    function appendTemplate(target, template) {
      const wrapper = document.createElement("div");
      wrapper.innerHTML = document.getElementById(template).innerHTML;
      document.getElementById(target).appendChild(wrapper.firstElementChild);
    }
    function addNote() { appendTemplate("notes", "note-template"); }
    function addIdea() { appendTemplate("ideas", "idea-template"); }
    const uploadForm = document.getElementById("upload-form");
    const uploadInput = document.getElementById("image");
    const uploadButton = document.getElementById("upload-button");
    const progressBox = document.getElementById("upload-progress");
    const progressBar = document.getElementById("upload-bar");
    const progressText = document.getElementById("upload-text");
    const progressPercent = document.getElementById("upload-percent");
    const progressList = document.getElementById("upload-list");
    const basePath = ${JSON.stringify(BASE_PATH)};

    function setProgress(value, text) {
      const percent = Math.max(0, Math.min(100, Math.round(value)));
      progressBar.style.width = percent + "%";
      progressPercent.textContent = percent + "%";
      progressText.textContent = text;
    }

    function uploadOne(data, file, index, total) {
      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", basePath + "/upload");
        xhr.setRequestHeader("Accept", "application/json");
        xhr.setRequestHeader("X-Requested-With", "XMLHttpRequest");
        xhr.upload.onprogress = (event) => {
          if (!event.lengthComputable) return;
          const current = event.loaded / event.total;
          setProgress(((index + current) / total) * 100, "正在上传 " + file.name + "（" + (index + 1) + "/" + total + "）");
        };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            progressList.children[index].textContent = "已完成：" + file.name;
            resolve();
            return;
          }
          reject(new Error(xhr.responseText || "上传失败"));
        };
        xhr.onerror = () => reject(new Error("网络中断，上传失败"));
        xhr.send(data);
      });
    }

    uploadForm.addEventListener("submit", async (event) => {
      if (!window.XMLHttpRequest || !window.FormData) return;
      event.preventDefault();
      const files = Array.from(uploadInput.files || []);
      if (!files.length) return;
      progressBox.classList.add("active");
      progressList.innerHTML = "";
      files.forEach((file) => {
        const item = document.createElement("li");
        item.textContent = "等待上传：" + file.name;
        progressList.appendChild(item);
      });
      uploadButton.disabled = true;
      uploadButton.textContent = "上传中...";
      setProgress(0, "准备上传 " + files.length + " 张图片");

      try {
        const form = new FormData(uploadForm);
        const albumName = String(form.get("albumName") || "${DEFAULT_ALBUM}").trim() || "${DEFAULT_ALBUM}";
        const title = String(form.get("imageTitle") || "").trim();
        const caption = String(form.get("imageCaption") || "").trim();
        const privateAlbum = form.get("privateAlbum") ? "1" : "";
        const csrfToken = String(form.get("_csrf") || "");
        for (let i = 0; i < files.length; i += 1) {
          const file = files[i];
          const data = new FormData();
          const fileTitle = title ? (files.length > 1 ? title + " " + (i + 1) : title) : file.name.replace(/\\.[^.]+$/, "");
          data.append("albumName", albumName);
          data.append("imageTitle", fileTitle);
          data.append("imageCaption", caption);
          if (privateAlbum) data.append("privateAlbum", privateAlbum);
          if (csrfToken) data.append("_csrf", csrfToken);
          data.append("image", file, file.name);
          await uploadOne(data, file, i, files.length);
        }
        setProgress(100, "上传完成，正在刷新页面");
        window.location.href = basePath + "/?msg=" + encodeURIComponent(files.length + " 张图片已上传并发布");
      } catch (error) {
        setProgress(0, error.message || "上传失败");
        uploadButton.disabled = false;
        uploadButton.textContent = "重新上传";
      }
    });
  </script>
</body>
</html>`;
}

function renderAdminAlbums(albums, privateMode) {
  if (!albums.length) return `<p>${privateMode ? "还没有私密图片。" : "还没有公开图片。"}</p>`;
  const base = galleryBasePath(privateMode);
  return albums.map((album) => `<div class="album-block">
        <h3>${html(album.name)} <span>${album.count} 张</span></h3>
        <form class="rename-form" method="post" action="${BASE_PATH}/rename-album">
          <input type="hidden" name="oldAlbum" value="${attr(album.name)}">
          <input type="hidden" name="privateAlbum" value="${privateMode ? "1" : "0"}">
          <label>相册名称<input name="newAlbum" value="${attr(album.name)}" required></label>
          <button class="secondary" type="submit">保存名称</button>
        </form>
        <div class="gallery">${album.items.map((item) => `<figure>
        <img src="${attr(imagePreviewSrc(item))}" alt="${attr(item.title || "相册图片")}">
        <figcaption>
          <strong>${html(item.title || "未命名图片")}</strong><br>
          ${html(item.caption || "")}<br>
          <a href="${base}/${album.slug}/${imageSlug(item, item.index)}/" target="_blank" rel="noopener">查看页面</a> · <a href="${attr(item.src)}" download>下载原图</a>
          <form method="post" action="${BASE_PATH}/delete-image" style="box-shadow:none;border:0;padding:10px 0 0;margin:0;background:transparent">
            <input type="hidden" name="src" value="${attr(item.src)}">
            <button class="danger" type="submit">删除</button>
          </form>
        </figcaption>
      </figure>`).join("")}</div>
      </div>`).join("");
}

function loginPageStyles() {
  return `
    :root { --bg:#f6f8f6; --ink:#1e2b2d; --muted:#627174; --line:#dbe6e1; --green:#3f806b; --gold:#b9904a; --surface:#fff; --danger:#a8422d; }
    * { box-sizing:border-box; }
    body { min-height:100vh; margin:0; display:grid; place-items:center; padding:28px 16px; font-family:"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif; color:var(--ink); background:linear-gradient(135deg,#f6f8f6 0%,#edf4f1 48%,#f8f3e8 100%); }
    main { width:min(430px,100%); }
    .login-box { padding:28px; border:1px solid rgba(63,128,107,.22); border-radius:8px; background:rgba(255,255,255,.92); box-shadow:0 24px 70px rgba(30,43,45,.14); backdrop-filter:blur(14px); }
    .mark { width:44px; height:44px; display:grid; place-items:center; border-radius:8px; background:#edf6f2; color:var(--green); font-weight:900; margin-bottom:18px; }
    h1 { margin:0; font-size:26px; letter-spacing:0; }
    p { margin:10px 0 0; color:var(--muted); line-height:1.65; }
    form { margin-top:22px; }
    label { display:block; margin:14px 0 7px; color:#4b5d60; font-size:14px; font-weight:800; }
    input { width:100%; border:1px solid var(--line); border-radius:8px; padding:12px 13px; font:inherit; color:var(--ink); background:#fff; outline:none; }
    input:focus { border-color:var(--green); box-shadow:0 0 0 4px rgba(63,128,107,.12); }
    button { width:100%; margin-top:18px; border:0; border-radius:8px; padding:12px 14px; font:inherit; font-weight:900; cursor:pointer; color:#fff; background:linear-gradient(135deg,var(--green),#2f6758); }
    .error { margin-top:14px; padding:10px 12px; border-radius:8px; color:var(--danger); background:#fff0ec; font-weight:800; }
    .footer { margin-top:16px; text-align:center; font-size:13px; }
    .footer a { color:var(--green); text-decoration:none; font-weight:800; }
  `;
}

function renderLoginPage(options) {
  const usernameField = options.usernameField
    ? `<label>${html(options.usernameLabel || "账号")}<input name="username" autocomplete="username" value="${attr(options.usernameValue || "")}" required></label>`
    : "";
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${html(options.title)} - xx520 小站</title>
  <style>${loginPageStyles()}</style>
</head>
<body>
  <main>
    <section class="login-box">
      <div class="mark">${html(options.mark || "xx")}</div>
      <h1>${html(options.title)}</h1>
      <p>${html(options.subtitle)}</p>
      ${options.error ? `<p class="error">${html(options.error)}</p>` : ""}
      <form method="post" action="${attr(options.action)}">
        <input type="hidden" name="next" value="${attr(options.next || "")}">
        ${usernameField}
        <label>${html(options.passwordLabel || "密码")}<input name="password" type="password" autocomplete="${options.usernameField ? "current-password" : "one-time-code"}" autofocus required></label>
        <button type="submit">进入</button>
      </form>
      <p class="footer"><a href="/">返回首页</a></p>
    </section>
  </main>
</body>
</html>`;
}

function workspaceStatsV2(content) {
  const blocks = getTestBlocks(content);
  const demold = splitReminderItems(getReminderItems(content, "demold"));
  const ages = splitReminderItems(getReminderItems(content, "age"));
  const allTasks = getCalendarItems(content);
  return {
    blocks: blocks.length,
    today: demold.today.length + ages.today.length,
    overdue: demold.overdue.length + ages.overdue.length,
    done: allTasks.filter((item) => item.completed).length
  };
}

function workspaceStylesV2() {
  return `
    :root { --bg:#f5f7f6; --surface:#fff; --soft:#eef5f2; --ink:#182426; --muted:#637376; --line:#dce6e2; --green:#337861; --blue:#3d6f98; --warn:#9a6425; --danger:#a8422d; --shadow:0 18px 45px rgba(29,48,50,.08); }
    * { box-sizing:border-box; }
    body { margin:0; font-family:"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif; background:linear-gradient(180deg,#eef5f2 0,#f5f7f6 320px); color:var(--ink); }
    header { position:sticky; top:0; z-index:10; background:rgba(245,247,246,.9); border-bottom:1px solid rgba(220,230,226,.86); backdrop-filter:blur(14px); }
    .bar, main { width:min(1240px, calc(100% - 32px)); margin:0 auto; }
    .bar { min-height:72px; display:flex; align-items:center; justify-content:space-between; gap:18px; }
    h1, h2, h3, h4, p { overflow-wrap:anywhere; }
    h1 { margin:3px 0 0; font-size:26px; line-height:1.1; }
    h2 { margin:0; font-size:22px; line-height:1.25; }
    h3 { margin:0; font-size:17px; }
    h4 { margin:0 0 12px; font-size:15px; }
    p { margin:0; }
    a { color:var(--green); text-decoration:none; font-weight:800; }
    nav { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
    nav a { min-height:36px; display:inline-flex; align-items:center; padding:0 12px; border:1px solid transparent; border-radius:8px; color:var(--muted); }
    nav a:hover, .nav-logout { border-color:var(--line); background:#fff; color:var(--green); }
    main { padding:26px 0 72px; }
    .eyebrow { margin:0; color:var(--green); font-size:12px; font-weight:900; letter-spacing:0; text-transform:uppercase; }
    .workspace-hero { display:grid; grid-template-columns:minmax(0,1fr) minmax(330px,.72fr); gap:20px; align-items:end; margin-bottom:18px; padding:24px; border:1px solid var(--line); border-radius:8px; background:linear-gradient(135deg,#fff,rgba(238,245,242,.88)); box-shadow:var(--shadow); }
    .workspace-hero h2 { max-width:780px; margin:8px 0 10px; font-size:30px; }
    .workspace-hero p:not(.eyebrow) { max-width:760px; color:var(--muted); line-height:1.7; }
    .hero-stats { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; }
    .hero-stats span { min-height:76px; padding:14px; border:1px solid var(--line); border-radius:8px; background:#fff; color:var(--muted); font-weight:800; }
    .hero-stats strong { display:block; margin-bottom:2px; color:var(--ink); font-size:30px; line-height:1; }
    .message { margin:0 0 18px; padding:13px 15px; border:1px solid #bfe2d5; border-radius:8px; background:#edf8f3; color:#225f4b; font-weight:900; }
    .panel { margin:0 0 18px; padding:20px; background:var(--surface); border:1px solid var(--line); border-radius:8px; box-shadow:var(--shadow); }
    .panel-title { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; margin-bottom:16px; }
    .panel-title p { margin-top:5px; color:var(--muted); line-height:1.6; }
    form { margin:0; }
    label, .field { display:block; color:var(--muted); font-size:13px; font-weight:900; }
    input, textarea, select { width:100%; min-height:44px; border:1px solid var(--line); border-radius:8px; padding:10px 12px; font:inherit; color:var(--ink); background:#fff; outline:none; }
    input:focus, textarea:focus { border-color:#8cc5b2; box-shadow:0 0 0 3px rgba(51,120,97,.12); }
    textarea { min-height:96px; resize:vertical; }
    button { border:0; border-radius:8px; padding:10px 14px; font:inherit; font-weight:900; cursor:pointer; background:var(--green); color:#fff; }
    button.secondary { background:#edf6f2; color:var(--green); }
    button.danger { background:#fff0ec; color:var(--danger); }
    .hint { margin-top:8px; color:var(--muted); font-size:13px; line-height:1.55; }
    .form-grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:14px; }
    .form-grid .wide, .record-grid .wide { grid-column:1 / -1; }
    .field span, .record-form label span { display:block; margin-bottom:6px; }
    .actions { display:flex; flex-wrap:wrap; align-items:center; gap:10px; margin-top:18px; }
    .age-toolbar { display:flex; flex-wrap:wrap; gap:6px; margin-top:8px; }
    .chip-button { min-height:30px; padding:0 10px; border:1px solid var(--line); background:#fff; color:var(--muted); font-size:12px; }
    .work-grid { display:grid; grid-template-columns:minmax(0,1.1fr) minmax(320px,.9fr); gap:18px; align-items:start; }
    .today-stack { display:grid; gap:10px; }
    .today-group { padding:14px; border:1px solid var(--line); border-radius:8px; background:#fbfdfc; }
    .today-group.warning { border-color:#f1c9b8; background:#fff8f4; }
    .today-group strong { display:flex; justify-content:space-between; gap:10px; margin-bottom:10px; }
    .summary-grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:14px; }
    .summary-card { min-height:142px; padding:16px; border:1px solid var(--line); border-radius:8px; background:#fff; }
    .summary-card strong { display:flex; justify-content:space-between; gap:10px; margin-bottom:10px; }
    .summary-card strong b { color:var(--green); font-size:22px; line-height:1; }
    .summary-card.overdue { border-color:#f0c7ba; background:#fff7f3; }
    .summary-card.upcoming { background:#fbfcff; }
    .task-list { display:grid; gap:8px; }
    .task-form { display:flex; align-items:flex-start; gap:9px; margin:0; padding:0; border:0; border-radius:0; background:transparent; box-shadow:none; }
    .task-form input { width:17px; min-height:17px; margin:2px 0 0; accent-color:var(--green); flex:0 0 auto; }
    .task-form span { color:var(--muted); font-size:13px; line-height:1.4; }
    .task-form.completed span { color:#8a989a; text-decoration:line-through; }
    .calendar-board { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:14px; }
    .month-card { border:1px solid var(--line); border-radius:8px; overflow:hidden; background:#fff; }
    .month-card h3 { margin:0; padding:13px 14px; background:#edf6f2; font-size:16px; }
    .weekdays, .calendar-days { display:grid; grid-template-columns:repeat(7,minmax(0,1fr)); }
    .weekdays span { padding:8px 4px; color:var(--muted); text-align:center; font-size:12px; font-weight:900; border-bottom:1px solid var(--line); }
    .day-cell { min-height:96px; padding:7px; border-right:1px solid var(--line); border-bottom:1px solid var(--line); background:#fff; }
    .day-cell:nth-child(7n) { border-right:0; }
    .day-cell.empty { background:#f8faf9; }
    .day-number { display:inline-flex; min-width:24px; height:24px; align-items:center; justify-content:center; border-radius:999px; font-weight:900; font-size:12px; }
    .day-cell.today .day-number { background:var(--green); color:#fff; }
    .due-pill { margin-top:6px; padding:6px; border-radius:7px; background:#fff7ed; color:var(--warn); font-size:12px; line-height:1.25; }
    .due-pill.demold { background:#edf6f2; color:#2f6f5b; }
    .due-pill.completed { background:#eef1f1; color:#7a8b8d; }
    .due-pill.task-form span { color:inherit; font-size:12px; }
    .block-toolbar { display:grid; grid-template-columns:minmax(0,1fr) auto; gap:12px; align-items:center; margin-bottom:14px; }
    .block-toolbar input { background:#fbfdfc; }
    .block-list { display:grid; gap:12px; }
    .block-card { padding:0; border:1px solid var(--line); border-radius:8px; background:#fff; overflow:hidden; }
    .block-head { display:grid; grid-template-columns:minmax(0,1fr) auto; gap:12px; padding:16px; border-bottom:1px solid var(--line); background:#fbfdfc; }
    .block-title { display:flex; align-items:center; gap:10px; flex-wrap:wrap; margin-bottom:8px; }
    .block-title strong { font-size:18px; }
    .badge { min-height:24px; display:inline-flex; align-items:center; padding:0 9px; border-radius:999px; background:#edf6f2; color:var(--green); font-size:12px; font-weight:900; }
    .block-meta { display:flex; flex-wrap:wrap; gap:8px; color:var(--muted); font-size:13px; }
    .block-meta span { min-height:28px; display:inline-flex; align-items:center; padding:0 9px; border:1px solid var(--line); border-radius:999px; background:#fff; }
    .task-checks { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:8px 14px; padding:14px 16px; border-bottom:1px solid var(--line); }
    .record-details { border:0; background:#fff; }
    .record-details summary { cursor:pointer; display:flex; justify-content:space-between; gap:12px; padding:15px 16px; font-weight:900; color:var(--green); list-style:none; }
    .record-details summary::-webkit-details-marker { display:none; }
    .record-details summary em { color:var(--muted); font-style:normal; font-weight:700; font-size:13px; text-align:right; }
    .record-details summary:after { content:"展开"; min-width:44px; color:var(--blue); font-size:13px; text-align:right; }
    .record-details[open] summary:after { content:"收起"; }
    .record-form { padding:0 16px 18px; border-top:1px solid var(--line); background:#fbfdfc; }
    .record-section { margin-top:16px; padding:14px; border:1px solid var(--line); border-radius:8px; background:#fff; }
    .record-grid { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:12px; }
    .record-form .actions { margin-top:14px; }
    .inline-delete { margin:0; padding:0; border:0; background:transparent; box-shadow:none; }
    .hidden { display:none !important; }
    @media (max-width:980px) { .workspace-hero, .work-grid, .calendar-board, .summary-grid { grid-template-columns:1fr; } .form-grid, .record-grid { grid-template-columns:repeat(2,minmax(0,1fr)); } }
    @media (max-width:640px) { .bar { align-items:flex-start; flex-direction:column; padding:14px 0; } nav a { padding:0 10px; } .workspace-hero, .panel { padding:16px; } .workspace-hero h2 { font-size:24px; } .hero-stats, .form-grid, .block-head, .block-toolbar, .task-checks, .record-grid { grid-template-columns:1fr; } .record-details summary { flex-direction:column; } .record-details summary em { text-align:left; } }
  `;
}

function renderMetricCardsV22(content) {
  const stats = workspaceMetricsV22(content);
  return `<section class="metric-grid-v22" aria-label="核心指标">
      <a class="metric-card-v22 neutral" href="#gangue-archive" aria-label="查看煤矸石档案"><span>煤矸石批次</span><strong>${stats.gangues}</strong><small>已建档材料批次</small></a>
      <a class="metric-card-v22 neutral" href="#block-management" aria-label="查看试块管理"><span>试块组数</span><strong>${stats.blockGroups}</strong><small>以试块组为统计单位</small></a>
      <a class="metric-card-v22 ${stats.dueUnrecorded ? "danger" : "ok"}" href="#today-tasks" aria-label="查看到期未录任务"><span>到期未录</span><strong>${stats.dueUnrecorded}</strong><small>今天及以前应完成</small></a>
      <a class="metric-card-v22 info" href="#calendar" aria-label="查看未来待测日历"><span>未来待测</span><strong>${stats.futurePending}</strong><small>未来 7 天未录结果</small></a>
      <a class="metric-card-v22 success" href="#analysis" aria-label="查看已录结果分析"><span>已录结果</span><strong>${stats.resultFilled}/${stats.resultTotal}</strong><small><i style="--p:${stats.resultPercent}%"></i>完成率 ${stats.resultPercent}%</small></a>
    </section>`;
}

function gangueKeyMetricStatusV22(gangue) {
  const checks = [
    { label: "压碎值", done: Boolean(gangue.batchCrushingValue) },
    { label: "吸水率", done: Boolean(gangue.coarseWaterAbsorption || gangue.fineWaterAbsorption) },
    { label: "表观密度", done: Boolean(gangue.coarseApparentDensity || gangue.fineApparentDensity) },
    { label: "图片", done: normalizeLabImages(gangue.images).length > 0 }
  ];
  const done = checks.filter((item) => item.done).length;
  return { checks, done, total: checks.length, percent: checks.length ? Math.round((done / checks.length) * 100) : 0 };
}

function gangueProgressRowsV22(content, referenceDate = today()) {
  return getCoalGangueDb(content).map((gangue) => {
    const blocks = blocksForGangueV3(content, gangue.id);
    const resultStats = resultStatsForBlocksV3(blocks);
    const resultItems = blockResultDueItemsV22(blocks);
    const unfilled = resultItems.filter((item) => !item.filled);
    const imageCount = normalizeLabImages(gangue.images).length
      + blocks.reduce((total, block) => total + normalizeLabImages(block.images).length, 0);
    const keyStatus = gangueKeyMetricStatusV22(gangue);
    return {
      gangue,
      blocks,
      resultStats,
      due: unfilled.filter((item) => item.date <= referenceDate).length,
      future: unfilled.filter((item) => item.date > referenceDate && item.date <= addDays(referenceDate, 7)).length,
      imageCount,
      keyStatus
    };
  }).sort((a, b) => b.blocks.length - a.blocks.length || b.resultStats.percent - a.resultStats.percent || a.gangue.name.localeCompare(b.gangue.name, "zh-CN"));
}

function ageCoverageColumnsV23(content) {
  const preferred = [3, 7, 28];
  const allAges = Array.from(new Set(getTestBlocks(content).flatMap((block) => normalizeAges(block.ages))))
    .map(Number)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  return [...preferred, ...allAges.filter((age) => !preferred.includes(age))];
}

function ageCoverageCellV23(block, age, referenceDate = today()) {
  if (!normalizeAges(block.ages).includes(age)) {
    return { state: "unset", label: "未设置", detail: `${block.name} 未选择 ${age}d` };
  }
  const dueDate = addDays(block.madeDate, age);
  const result = compressionResultByAgeV22(block, age);
  if (metricResultFilled(result)) {
    return { state: "done", label: "已录入", detail: `${age}d ${metricResultDisplay(result)}` };
  }
  if (dueDate <= referenceDate) {
    return { state: "due", label: "到期未录", detail: `应测 ${formatDateCnV3(dueDate)}` };
  }
  return { state: "future", label: "未来待测", detail: `应测 ${formatDateCnV3(dueDate)}` };
}

function ageCoverageRowsV23(content, referenceDate = today()) {
  return getTestBlocks(content)
    .slice()
    .sort((a, b) => b.madeDate.localeCompare(a.madeDate) || a.name.localeCompare(b.name, "zh-CN"))
    .map((block) => {
      const record = normalizeBlockRecord(block.record, block.ages, block.metrics, block.recipeMaterials);
      return {
        block,
        gangueName: record.gangueAggregateName || coalGangueNameById(content, record.gangueAggregateId) || "未归属",
        cells: ageCoverageColumnsV23(content).map((age) => ({ age, ...ageCoverageCellV23(block, age, referenceDate) }))
      };
    });
}

function renderAgeCoverageHeatmapV23(content) {
  const columns = ageCoverageColumnsV23(content);
  const rows = ageCoverageRowsV23(content);
  return `<div class="age-heatmap-v23" style="--age-cols:${columns.length}">
      <div class="heatmap-head-v23"><span>试块组</span>${columns.map((age) => `<b>${age}d</b>`).join("")}</div>
      ${rows.length ? rows.map((row) => `<a class="heatmap-row-v23" href="#record-${attr(row.block.id)}" data-open-record="${attr(row.block.id)}" data-record-tab-target="results">
          <strong><span>${html(row.block.name)}</span><small>${html(row.gangueName)} · 成型 ${html(formatDateCnV3(row.block.madeDate))}</small></strong>
          ${row.cells.map((cell) => `<em class="heat-cell-v23 ${attr(cell.state)}" title="${attr(cell.detail)}"><span>${html(cell.label)}</span><small>${html(cell.detail)}</small></em>`).join("")}
        </a>`).join("") : `<p class="empty-v22">还没有试块组，无法生成龄期热力图。</p>`}
      <div class="heatmap-legend-v23"><span class="done">已录入</span><span class="due">到期未录</span><span class="future">未来待测</span><span class="unset">未设置</span></div>
    </div>`;
}

function renderVisualInsightsV22(content) {
  const gangueRows = gangueProgressRowsV22(content);
  const ageRows = ageCoverageRowsV22(content);
  return `<section class="dashboard-card-v22 visual-insights-v22" id="visual-map">
      <div class="section-head-v22">
        <div><p class="eyebrow">Visual Map</p><h2>实验进度图谱</h2><p>按煤矸石批次看结果完成率、任务压力、图片归档和关键指标完整度。</p></div>
      </div>
      <div class="visual-map-grid-v22">
        <div class="progress-matrix-v22">
          <div class="progress-matrix-head-v22"><span>煤矸石批次</span><span>结果完成</span><span>任务</span><span>图片</span><span>档案</span></div>
          ${gangueRows.length ? gangueRows.map((row) => {
    const missing = row.keyStatus.checks.filter((item) => !item.done).map((item) => item.label).join("、") || "完整";
    return `<a class="progress-row-v22" href="#gangue-${attr(row.gangue.id)}" style="--p:${row.resultStats.percent}%">
            <strong>${html(row.gangue.name)}<small>${row.blocks.length} 组试块</small></strong>
            <span class="matrix-meter-v22"><i></i><b>${row.resultStats.filled}/${row.resultStats.total || 0}</b></span>
            <span class="${row.due ? "matrix-warn-v22" : ""}">到期 ${row.due} · 未来 ${row.future}</span>
            <span>${row.imageCount} 张</span>
            <span title="${attr(missing)}">${row.keyStatus.done}/${row.keyStatus.total}</span>
          </a>`;
  }).join("") : `<p class="empty-v22">还没有煤矸石批次。</p>`}
        </div>
        <div class="age-coverage-v22">
          <h3>龄期覆盖热力图</h3>
          ${renderAgeCoverageHeatmapV23(content)}
        </div>
      </div>
    </section>`;
}

function renderTaskTableV22(content) {
  const items = visibleTaskItemsV22(content);
  if (!items.length) {
    return `<section class="dashboard-card-v22" id="today-tasks">
      <div class="section-head-v22"><div><p class="eyebrow">Tasks</p><h2>今日待处理</h2></div></div>
      <p class="empty-v22">今天没有逾期或到期的拆模、强度结果。未来待测看上方指标和日历。</p>
    </section>`;
  }
  return `<section class="dashboard-card-v22" id="today-tasks">
      <div class="section-head-v22">
        <div><p class="eyebrow">Tasks</p><h2>今日待处理</h2><p>只显示今天或逾期需要行动的拆模、强度结果；未到期任务放到日历预告里。</p></div>
      </div>
      <div class="task-table-v22">
        <div class="task-row-v22 head"><span>日期</span><span>试块组</span><span>煤矸石</span><span>项目</span><span>状态</span><span>操作</span></div>
        ${items.map((item) => {
    const record = normalizeBlockRecord(item.block.record, item.block.ages, item.block.metrics, item.block.recipeMaterials);
    const gangueName = record.gangueAggregateName || coalGangueNameById(content, record.gangueAggregateId) || "未归属";
    const state = taskStateV22(item);
    return `<div class="task-row-v22 ${state}">
          <span>${html(formatDateCnV3(item.date))}</span>
          <strong>${html(item.block.name)}</strong>
          <span>${html(gangueName)}</span>
          <span>${html(item.type === "demold" ? "拆模" : `${item.age}d ${item.metric.label}`)}</span>
          <em class="status-pill-v22 status-${state}">${html(taskStateLabelV22(item))}</em>
          ${item.type === "demold" ? `<form class="task-action-form-v22" method="post" action="${WORK_PATH}/toggle-task">
            <input type="hidden" name="id" value="${attr(item.block.id)}">
            <input type="hidden" name="taskType" value="demold">
            <input type="hidden" name="done" value="1">
            <input type="hidden" name="returnAnchor" value="today-tasks">
            <button type="submit">完成</button>
          </form>` : `<a href="#record-${attr(item.block.id)}" data-open-record="${attr(item.block.id)}" data-record-tab-target="results">记录</a>`}
        </div>`;
  }).join("")}
      </div>
    </section>`;
}

function trendGroupsV22(content) {
  const gangues = getCoalGangueDb(content);
  const blocks = getTestBlocks(content);
  const validGangueIds = new Set(gangues.map((item) => item.id));
  const groupMap = new Map(gangues.map((item) => [item.id, { id: item.id, name: item.name, rows: [], max: 1 }]));
  blocks
    .slice()
    .sort((a, b) => b.madeDate.localeCompare(a.madeDate))
    .forEach((block) => {
      const selectedAges = new Set(normalizeAges(block.ages).map(String));
      const values = [3, 7, 28].map((age) => {
        if (!selectedAges.has(String(age))) return null;
        const result = compressionResultByAgeV22(block, age);
        const number = metricResultNumber(result);
        const dueDate = addDays(block.madeDate, age);
        const isDue = dueDate <= today();
        const meanText = formatMpaValue(result.mean || result.manualMean);
        return {
          age,
          number,
          mean: number ? meanText : (isDue ? "待录" : `应测 ${formatDateCnV3(dueDate)}`),
          label: number ? `${age}d ${meanText}` : `${age}d ${isDue ? "待录" : `应测 ${formatDateCnV3(dueDate)}`}`
        };
      }).filter(Boolean);
      const rawGangueId = blockGangueIdV3(block);
      const gangueId = rawGangueId && validGangueIds.has(rawGangueId) ? rawGangueId : "__unassigned__";
      const record = normalizeBlockRecord(block.record, block.ages, block.metrics, block.recipeMaterials);
      const gangueName = gangueId === "__unassigned__"
        ? (record.gangueAggregateName || "未归属煤矸石")
        : (coalGangueNameById(content, gangueId) || record.gangueAggregateName || "未归属煤矸石");
      if (!groupMap.has(gangueId)) groupMap.set(gangueId, { id: gangueId, name: gangueName, rows: [], max: 1 });
      groupMap.get(gangueId).rows.push({
        id: block.id,
        blockName: block.name,
        gangueName,
        values
      });
    });
  const groups = Array.from(groupMap.values()).map((group) => ({
    ...group,
    max: Math.max(1, ...group.rows.flatMap((row) => row.values.map((item) => item.number || 0)))
  }));
  const preferredId = chartGangueIdV22(content);
  const selectedId = (preferredId && groupMap.has(preferredId) ? preferredId : "") || groups.find((group) => group.rows.length)?.id || groups[0]?.id || "";
  const selectedGroup = groups.find((group) => group.id === selectedId) || groups[0] || { id: "", name: "暂无批次", rows: [], max: 1 };
  return { groups, selectedId, selectedGroup };
}

function renderTrendRowsForGroupV22(group) {
  if (!group || !group.rows.length) return `<p class="empty-v22" data-chart-empty>这个批次还没有可展示的试块强度。</p>`;
  return group.rows.map((row) => `<article class="trend-row-v22" data-chart-row>
          <strong title="${attr(`${row.gangueName}｜${row.blockName}`)}"><span>${html(row.blockName)}</span><small>${html(row.gangueName)}</small></strong>
          <div class="trend-bars-v22">
            ${row.values.map((item) => {
    const width = item.number ? Math.max(4, Math.min(100, (item.number / group.max) * 100)) : 0;
    return `<span class="trend-bar-v22 age-${item.age}${item.number ? " filled" : ""}" title="${attr(item.label)}">
              <i style="--w:${width}%" data-chart-bar data-chart-value="${attr(item.number || "")}"></i><b>${item.age}d</b><em>${html(item.mean || "")}</em>
            </span>`;
  }).join("")}
          </div>
        </article>`).join("");
}

function renderStrengthTrendPanelV22(content) {
  const trend = trendGroupsV22(content);
  const groups = trend.groups;
  return `<section class="dashboard-card-v22" id="analysis">
      <div class="section-head-v22">
        <div><p class="eyebrow">Analysis</p><h2>强度趋势图</h2><p>只显示当前选择的煤矸石批次；换批次后，下方试块组会同步切换。</p></div>
      </div>
      ${groups.length ? `<div class="trend-chart-v22" data-chart-stage style="--chart-max:${trend.selectedGroup.max}">
        <div class="chart-current-v22" data-chart-current>
          <span>当前批次</span>
          <select data-chart-filter aria-label="选择煤矸石批次">
            ${groups.map((item) => `<option value="${attr(item.id)}" ${item.id === trend.selectedId ? "selected" : ""}>${html(item.name)}</option>`).join("")}
          </select>
        </div>
        <div data-chart-rows>${renderTrendRowsForGroupV22(trend.selectedGroup)}</div>
      </div>
      <script type="application/json" id="trend-chart-data-v22">${scriptJson({ groups })}</script>` : `<p class="empty-v22">还没有可绘制的抗压强度结果。</p>`}
    </section>`;
}

function renderAnomalyPanelV22(content) {
  const items = abnormalItemsV22(content);
  return `<section class="dashboard-card-v22" id="anomalies">
      <div class="section-head-v22"><div><p class="eyebrow">Checks</p><h2>异常提醒</h2><p>严重、警告和需人工确认分开显示，避免把真实异常和录入错误混在一起。</p></div></div>
      ${items.length ? `<div class="anomaly-form-v22">
        <p class="anomaly-hint-v22">点每条右侧的“删除”按钮即可隐藏这条提醒，不会改实验数据。</p>
        <div class="anomaly-list-v22">
          ${items.map((item) => `<article class="anomaly-v22 ${attr(item.level)}" data-swipe-dismiss>
            <span>${html(item.title)}</span>
            <p>${html(item.text)}</p>
            <form method="post" action="${WORK_PATH}/dismiss-anomalies" data-dismiss-form>
              <input type="hidden" name="anomalyIds" value="${attr(item.id)}">
              <button class="anomaly-delete-button-v22" type="submit">删除</button>
            </form>
            <em class="swipe-hint-v22">左滑删除</em>
          </article>`).join("")}
        </div>
      </div>` : `<p class="empty-v22">暂无异常提醒。</p>`}
    </section>`;
}

function renderGangueOverviewV22(content) {
  const gangues = getCoalGangueDb(content);
  return `<section class="dashboard-card-v22" id="gangue-overview">
      <div class="section-head-v22"><div><p class="eyebrow">Coal Gangue</p><h2>煤矸石批次概览</h2></div><a href="#gangue-archive">管理档案</a></div>
      ${gangues.length ? `<div class="gangue-overview-grid-v22">
        ${gangues.map((item) => {
    const blocks = blocksForGangueV3(content, item.id);
    const resultStats = resultStatsForBlocksV3(blocks);
    const rangeText = item.particleRanges.length ? item.particleRanges.join("，") : "未填";
    return `<article class="gangue-summary-v22">
          <strong>${html(item.name)}</strong>
          <span>来源：${html(item.source || "未填")}</span>
          <span>粒径：${html(rangeText)}</span>
          <span>关联试块：${blocks.length} 组</span>
          <span>强度结果：${resultStats.filled}/${resultStats.total}</span>
          <span>压碎值：${html(item.batchCrushingValue || "未填")}</span>
          <span>吸水率：${html(item.coarseWaterAbsorption || item.fineWaterAbsorption || "未填")}</span>
          <div><a href="#gangue-${attr(item.id)}">查看档案</a><a href="#gangue-${attr(item.id)}">新建试块</a></div>
        </article>`;
  }).join("")}
      </div>` : `<p class="empty-v22">还没有煤矸石批次。</p>`}
    </section>`;
}

function blockSearchTextV3(block, content = {}) {
  const record = normalizeBlockRecord(block.record, block.ages, block.metrics, block.recipeMaterials);
  const category = normalizeBlockCategory(block.blockCategory);
  const scheme = gradationSchemeForCategory(category);
  const gradationTemplate = scheme.templates[normalizeGradationTemplate(record.gradationTemplate)] || scheme.templates.raw;
  const weighingTemplate = WEIGHING_TEMPLATES[normalizeWeighingTemplate(record.weighingTemplate, category)] || {};
  const gangueName = record.gangueAggregateName || coalGangueNameById(content, record.gangueAggregateId) || "";
  const acceleratorText = templateUsesAccelerator(normalizeWeighingTemplate(record.weighingTemplate, category)) ? "有速凝剂 速凝剂" : "无速凝剂 不用速凝剂";
  const ageText = block.ages.flatMap((age) => [`${age}`, `${age}d`, `${age}天`]);
  const materialText = record.recipeMaterials.flatMap((material) => {
    const value = record.recipeValues?.[material.id] || "";
    return [material.label, recipeMaterialCategory(material), value];
  });
  return [
    block.name,
    block.strength,
    block.note,
    blockCategoryLabelV3(category),
    record.mixName,
    record.recipeNote,
    gangueName,
    record.gangueAggregateId,
    scheme.label,
    scheme.ranges.join(" "),
    gradationTemplate.label,
    gradationTemplate.nValue ? `n=${gradationTemplate.nValue}` : "",
    record.gradationCoefficient ? `级配系数 ${record.gradationCoefficient}` : "",
    weighingTemplate.label,
    acceleratorText,
    ...ageText,
    ...materialText
  ].filter(Boolean).join(" ");
}

function blockConfigChipsV22(block, content, record) {
  const category = normalizeBlockCategory(block.blockCategory);
  const scheme = gradationSchemeForCategory(category);
  const template = scheme.templates[normalizeGradationTemplate(record.gradationTemplate)] || scheme.templates.raw;
  const weighingKey = normalizeWeighingTemplate(record.weighingTemplate, category);
  const gangueName = record.gangueAggregateName || coalGangueNameById(content, record.gangueAggregateId) || "未归属";
  const nText = template.nValue ? `n=${template.nValue}` : (record.gradationCoefficient ? `n=${record.gradationCoefficient}` : "原始级配");
  const accelerator = templateUsesAccelerator(weighingKey) ? "有速凝剂" : "无速凝剂";
  return [
    `批次：${gangueName}`,
    `用途：${blockCategoryLabelV3(category)}`,
    nText,
    accelerator,
    `粒径：${scheme.label || scheme.ranges.join("-")}`
  ];
}

function renderBlockStrengthBarsV22(block) {
  const ages = normalizeAges(block.ages);
  if (!ages.length) return "";
  const values = ages.map((age) => {
    const result = compressionResultByAgeV22(block, age);
    const number = metricResultNumber(result);
    const dueDate = addDays(block.madeDate, age);
    const isDue = dueDate <= today();
    return {
      age,
      result,
      number,
      dueDate,
      isDue,
      label: number ? metricResultDisplay(result) : (isDue ? "待录" : `应测 ${formatDateCnV3(dueDate)}`)
    };
  });
  const max = Math.max(1, ...values.map((item) => item.number || 0));
  return `<div class="strength-strip-v22" aria-label="已选龄期抗压强度">
      ${values.map((item) => {
    const width = item.number ? Math.max(5, Math.min(100, (item.number / max) * 100)) : 8;
    return `<span class="strength-bar-v22 age-${item.age} ${item.number ? "filled" : item.isDue ? "due" : "upcoming"}">
          <b>${item.age}d</b>
          <i style="--w:${width}%"></i>
          <em>${html(item.label)}</em>
        </span>`;
  }).join("")}
    </div>`;
}

function renderResearchBlockCardV22(block, content, options = {}) {
  const record = normalizeBlockRecord(block.record, block.ages, block.metrics, block.recipeMaterials);
  const ratios = calculateRecipeRatios(record);
  const latest = latestMetricResultForBlockV22(block);
  const gangueName = record.gangueAggregateName || coalGangueNameById(content, record.gangueAggregateId) || "未归属煤矸石";
  const gradationLabel = gradationSchemeForCategory(block.blockCategory).templates[normalizeGradationTemplate(record.gradationTemplate)]?.label || "原始级配";
  const weighingLabel = WEIGHING_TEMPLATES[normalizeWeighingTemplate(record.weighingTemplate, block.blockCategory)]?.label || "未选模板";
  const progress = block.ages.map((age) => {
    const result = compressionResultByAgeV22(block, age);
    const dueDate = addDays(block.madeDate, age);
    const isDue = dueDate <= today();
    return `<span class="${metricResultFilled(result) ? "done" : isDue ? "due" : "upcoming"}">${age}d ${metricResultFilled(result) ? "已录" : isDue ? "待录" : `应测 ${formatDateCnV3(dueDate)}`}</span>`;
  }).join("");
  return `<article class="research-block-v22">
      <div>
        <p>${html(blockCategoryLabelV3(block.blockCategory))}｜${html(gangueName)}</p>
        <h3>${html(block.name)}${block.strength ? `｜${html(block.strength)}` : ""}</h3>
        <small>成型：${html(formatDateCnV3(block.madeDate))} · ${html(block.quantity)} 块 · ${html(gradationLabel)} · ${html(weighingLabel)}</small>
      </div>
      <div class="config-chips-v22">${blockConfigChipsV22(block, content, record).map((chip) => `<span>${html(chip)}</span>`).join("")}</div>
      <div class="block-facts-v22">
        <span>水胶比：${html(record.waterBinderRatio || (ratios.waterBinderRatio ? formatRecipeNumber(ratios.waterBinderRatio) : "未填"))}</span>
        <span>骨灰比：${html(ratios.aggregateBinderRatio ? formatRecipeNumber(ratios.aggregateBinderRatio) : "未填")}</span>
        <span>最新强度：${latest ? `${html(latest.age)}d ${html(metricResultDisplay(latest.result))}` : "未录入"}</span>
      </div>
      ${renderBlockStrengthBarsV22(block)}
      <div class="age-progress-v22">${progress}</div>
      <div class="card-actions-v22">
        <a href="#record-${attr(block.id)}" data-open-record="${attr(block.id)}" data-record-tab-target="results">记录强度</a>
        <a href="#record-${attr(block.id)}" data-open-record="${attr(block.id)}" data-record-tab-target="images">上传图片</a>
        ${options.detail !== false ? `<a href="#record-${attr(block.id)}" data-open-record="${attr(block.id)}">查看详情</a>` : ""}
      </div>
    </article>`;
}

function renderRecentBlocksV22(content) {
  const blocks = getTestBlocks(content)
    .slice()
    .sort((a, b) => b.madeDate.localeCompare(a.madeDate))
    .slice(0, 6);
  return `<section class="dashboard-card-v22" id="recent-blocks">
      <div class="section-head-v22"><div><p class="eyebrow">Recent</p><h2>最近试块组</h2></div><a href="#block-management">查看全部</a></div>
      ${blocks.length ? `<div class="recent-block-grid-v22">${blocks.map((block) => renderResearchBlockCardV22(block, content)).join("")}</div>` : `<p class="empty-v22">还没有试块组。</p>`}
    </section>`;
}

function renderCollapsedCalendarV22(content, actionBase) {
  return `<details class="dashboard-card-v22 calendar-collapse-v22" id="calendar">
      <summary><span><b>实验日历</b><em>展开查看整月拆模和龄期事项</em></span><strong>展开</strong></summary>
      <div class="calendar-inner-v22">${renderBlockCalendarV3(content, actionBase)}</div>
    </details>`;
}

function renderNewGanguePanelV22(actionBase) {
  return `<details class="dashboard-card-v22 create-panel-v22" id="new-gangue">
      <summary><span><b>新建煤矸石批次</b><em>不是每天都用，默认收起，需要时再展开。</em></span><strong>新增</strong></summary>
      <form method="post" action="${actionBase}/add-gangue">
        <div class="form-grid">
          <label class="field"><span>煤矸石编号/名称</span><input name="gangueName" placeholder="例：SZ-01 朔州煤矸石" required></label>
          <label class="field"><span>来源/批次</span><input name="source" placeholder="例：朔州 XX 矿 2026-05"></label>
          <label class="field wide"><span>粒径区间</span><input name="particleRanges" value="${attr(defaultParticleRanges().join(","))}"></label>
          <label class="field"><span>粗骨料吸水率</span><input name="coarseWaterAbsorption" placeholder="例：5.2%"></label>
          <label class="field"><span>细骨料吸水率</span><input name="fineWaterAbsorption" placeholder="例：7.8%"></label>
          <label class="field"><span>粗骨料表观密度</span><input name="coarseApparentDensity" placeholder="例：2450kg/m3"></label>
          <label class="field"><span>细骨料表观密度</span><input name="fineApparentDensity" placeholder="例：2380kg/m3"></label>
          <label class="field wide"><span>其他信息</span><input name="otherInfo" placeholder="颜色、采样人、含泥量、筛分状态、备注"></label>
        </div>
        <div class="actions"><button class="secondary" type="submit">建立煤矸石档案</button></div>
      </form>
    </details>`;
}

function renderGangueArchiveV22(content, actionBase) {
  const gangues = getCoalGangueDb(content);
  const orphans = orphanBlocksV3(content);
  return `<section class="dashboard-section-v22" id="gangue-archive">
      <div class="section-title-v22"><p class="eyebrow">Archive</p><h2>煤矸石档案</h2><p>按煤矸石编号归档级配、图片、喷浆试块和道路试块。</p></div>
      ${renderNewGanguePanelV22(actionBase)}
      <div class="gangue-folder-list">
        ${gangues.length ? gangues.map((item) => renderGangueExperimentFolderV3(item, content, actionBase)).join("") : `<article class="panel"><p class="hint">先新增一个煤矸石编号。</p></article>`}
      </div>
      ${orphans.length ? `<section class="panel orphan-panel">${renderNestedBlockListV3(orphans, actionBase, content, "未归属煤矸石的旧试块")}</section>` : ""}
    </section>`;
}

function renderBlockManagementV22(content, actionBase) {
  const blocks = getTestBlocks(content);
  return `<section class="dashboard-section-v22" id="block-management">
      <div class="section-title-v22"><p class="eyebrow">Blocks</p><h2>试块管理</h2><p>试块组是最小实验管理单位，强度结果和图片都归到这里。</p></div>
      <section class="dashboard-card-v22">
        <div class="block-toolbar">
          <input id="blockSearch" type="search" placeholder="搜索名称、煤矸石、n值、粒径、材料、龄期">
          <span class="hint">共 ${blocks.length} 组</span>
          <div class="archive-actions" aria-label="试块导出操作">
            <button class="chip-button" type="button" data-check-all-export>全选导出</button>
            <button class="chip-button" type="button" data-clear-export>清空选择</button>
            <button class="chip-button" type="submit" form="exportBlocksForm">导出选中 Excel</button>
            <button class="chip-button" type="submit" form="exportBlocksForm" name="exportAll" value="1">导出全部 Excel</button>
          </div>
        </div>
        <form id="exportBlocksForm" method="post" action="${actionBase}/export-blocks"></form>
        ${blocks.length ? `<div class="recent-block-grid-v22 all-blocks-v22">
          ${blocks.map((block) => {
    const searchText = blockSearchTextV3(block, content);
    return `<div data-block-card data-search="${attr(searchText)}">
            <label class="export-check"><input form="exportBlocksForm" type="checkbox" name="blockIds" value="${attr(block.id)}" data-export-check><span>导出</span></label>
            ${renderResearchBlockCardV22(block, content)}
          </div>`;
  }).join("")}
        </div>` : `<p class="empty-v22">还没有试块组。</p>`}
      </section>
    </section>`;
}

function renderWorkspaceV3(content, message = "") {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>煤矸石实验工作区 - ${html(content.siteTitle)}</title>
  <style>${workspaceStylesV3()}</style>
</head>
<body class="dashboard-shell-v22">
  <div class="app-shell-v22">
    <aside class="sidebar-v22">
      <a class="side-brand-v22" href="${WORK_PATH}/"><span>CG</span><strong>煤矸石实验工作区</strong></a>
      <nav aria-label="工作区模块">
        <a href="#overview" aria-current="page">总览</a>
        <a href="#gangue-archive">煤矸石档案</a>
        <a href="#block-management">试块管理</a>
        <a href="#analysis">数据分析</a>
        <a href="#material-library">材料库</a>
      </nav>
      <div class="side-foot-v22">
        <a href="/" target="_blank" rel="noopener">公开首页</a>
        <a href="${WORK_PATH}/logout">退出</a>
      </div>
    </aside>
    <div class="workspace-v22">
      <header class="topbar-v22">
        <div>
          <p class="eyebrow">Research Dashboard</p>
          <h1>煤矸石基道路混凝土实验数据管理与分析平台</h1>
        </div>
        <label class="global-search-v22"><span>搜索</span><div class="search-field-v22"><input id="globalBlockSearch" type="search" placeholder="搜索试块 / 煤矸石 / n值 / 速凝剂 / 强度等级"><button type="button" data-search-submit aria-label="执行搜索">查</button></div></label>
        <div class="top-actions-v22">
          <a href="#recent-blocks">记录强度</a>
          <a href="#gangue-archive">新建试块组</a>
          <button type="submit" form="exportBlocksForm" name="exportAll" value="1">导出全部 Excel</button>
        </div>
      </header>
      <main class="work-main-v22">
        ${message ? `<p class="message">${html(message)}</p>` : ""}
        <section class="dashboard-section-v22" id="overview">
          ${renderMetricCardsV22(content)}
          ${renderVisualInsightsV22(content)}
          <div class="overview-grid-v22">
            ${renderTaskTableV22(content)}
            ${renderStrengthTrendPanelV22(content)}
          </div>
          <div class="overview-grid-v22 compact">
            ${renderAnomalyPanelV22(content)}
            ${renderGangueOverviewV22(content)}
          </div>
          ${renderRecentBlocksV22(content)}
          ${renderCollapsedCalendarV22(content, WORK_PATH)}
        </section>
        ${renderGangueArchiveV22(content, WORK_PATH)}
        ${renderBlockManagementV22(content, WORK_PATH)}
        <section class="dashboard-section-v22" id="material-library">
          <div class="section-title-v22"><p class="eyebrow">Materials</p><h2>材料库</h2><p>材料库单独管理，可隐藏、删除和新增，旧试块历史数据保留。</p></div>
          ${renderRecipeMaterialLibraryManagerV3(content, WORK_PATH)}
        </section>
      </main>
    </div>
  </div>
  ${renderTemplateDataScriptV3()}
  ${renderWorkspaceScriptV3()}
</body>
</html>`;
}

function workspaceStylesV3() {
  return `${workspaceStylesV2()}
    body { background:linear-gradient(180deg,#edf4f7 0,#f6f8f6 340px); }
    header { background:rgba(246,248,246,.86); }
    .bar { min-height:78px; }
    nav a { background:rgba(255,255,255,.5); }
    .workspace-hero { position:relative; overflow:hidden; min-height:260px; background:linear-gradient(135deg,#ffffff 0%,#f4faf7 58%,#edf4fb 100%); border-color:rgba(196,213,211,.9); box-shadow:0 24px 70px rgba(28,50,55,.11); }
    .workspace-hero:before { content:""; position:absolute; inset:0; background:linear-gradient(90deg,rgba(51,120,97,.08),transparent 44%),linear-gradient(180deg,transparent,rgba(255,255,255,.52)); pointer-events:none; }
    .workspace-hero > * { position:relative; }
    .workspace-hero h2 { font-size:34px; line-height:1.14; }
    .hero-stats span { background:rgba(255,255,255,.82); box-shadow:0 16px 40px rgba(24,36,38,.06); }
    .lab-layout { display:grid; gap:18px; }
    .lab-overview { display:grid; grid-template-columns:1.05fr .95fr; gap:18px; align-items:start; }
    .top-work-grid { align-items:start; }
    .top-work-grid .lab-overview { grid-column:auto; }
    .visual-panel { padding:18px; border:1px solid rgba(205,220,217,.92); border-radius:8px; background:#fff; box-shadow:0 18px 54px rgba(29,48,50,.08); }
    .visual-panel h3 { margin:0 0 12px; color:var(--green); font-size:18px; }
    .stat-strip { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:10px; margin-bottom:14px; }
    .stat-strip span { display:grid; gap:4px; padding:12px; border:1px solid var(--line); border-radius:8px; background:#fbfdfc; }
    .stat-strip b { color:var(--ink); font-size:24px; line-height:1; }
    .stat-strip small { color:var(--muted); font-weight:800; }
    .calendar-dashboard { display:grid; gap:14px; margin:16px 0; }
    .calendar-kpis { display:grid; grid-template-columns:repeat(5,minmax(0,1fr)); gap:10px; }
    .calendar-kpis span { display:grid; gap:5px; padding:12px; border:1px solid var(--line); border-radius:8px; background:#fbfdfc; }
    .calendar-kpis b { color:var(--ink); font-size:24px; line-height:1; }
    .calendar-kpis small { color:var(--muted); font-size:12px; font-weight:900; }
    .calendar-kpis .danger b { color:#a8422d; }
    .calendar-kpis .today b { color:var(--green); }
    .calendar-agenda { padding:14px; border:1px solid var(--line); border-radius:8px; background:#fff; }
    .calendar-agenda-head { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; margin-bottom:10px; }
    .calendar-agenda-head h3 { margin:0; color:var(--green); font-size:17px; }
    .calendar-agenda-head p { margin:3px 0 0; color:var(--muted); font-size:13px; font-weight:800; }
    .calendar-legend { display:flex; gap:7px; flex-wrap:wrap; justify-content:flex-end; }
    .calendar-legend span { min-height:28px; display:inline-flex; align-items:center; gap:6px; padding:0 9px; border:1px solid var(--line); border-radius:999px; background:#fbfdfc; color:var(--muted); font-size:12px; font-weight:900; }
    .calendar-legend span:before { content:""; width:8px; height:8px; border-radius:999px; background:#cbd8d4; }
    .calendar-legend .demold:before { background:#337861; }
    .calendar-legend .age:before { background:#d28b34; }
    .calendar-legend .result:before { background:#3d6f98; }
    .calendar-legend .overdue:before { background:#a8422d; }
    .calendar-agenda-list { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:8px; }
    .calendar-task-link-v22 { display:flex; align-items:center; gap:8px; text-decoration:none; cursor:pointer; }
    .calendar-task-link-v22 span { color:inherit; font-size:13px; line-height:1.35; }
    .calendar-task-link-v22.completed span { color:#7a8b8d; text-decoration:line-through; }
    .calendar-task-link-v22.due-pill { display:block; }
    .calendar-task-link-v22.due-pill span { font-size:12px; }
    .agenda-task { min-height:42px; padding:8px 10px; border:1px solid var(--line); border-radius:8px; background:#fbfdfc; }
    .agenda-task.today { border-color:#c7dfd6; background:#edf6f2; }
    .agenda-task.overdue { border-color:#e7c4b8; background:#fff7ed; color:#8b3d2a; }
    .agenda-task.completed { opacity:.65; background:#f1f4f3; }
    .day-cell.has-due { background:#fffefd; }
    .day-cell.has-overdue { background:#fff8f3; }
    .day-cell.all-completed { background:#f5f7f7; }
    .due-pill.today { border:1px solid #c7dfd6; background:#edf6f2; color:var(--green); }
    .due-pill.overdue { border:1px solid #e7c4b8; background:#fff1e8; color:#8b3d2a; }
    .due-pill.upcoming { border:1px solid #f0d6ad; background:#fff8eb; }
    .due-pill.result { border:1px solid #c8dcef; background:#f3f8fc; color:#3d6f98; }
    .viz-list { display:grid; gap:9px; }
    .viz-row { display:grid; grid-template-columns:112px minmax(0,1fr) 54px; gap:10px; align-items:center; color:var(--muted); font-size:12px; font-weight:900; }
    .viz-track { overflow:hidden; height:11px; border-radius:999px; background:#e8efed; }
    .viz-fill { display:block; width:var(--w,0%); height:100%; border-radius:999px; background:linear-gradient(90deg,#337861,#88b6a8); }
    .viz-fill.warn { background:linear-gradient(90deg,#a8422d,#e4b04c); }
    .gangue-folder-list { display:grid; gap:16px; }
    .gangue-folder { border:1px solid rgba(195,214,210,.95); border-radius:8px; background:#fff; overflow:hidden; box-shadow:0 18px 54px rgba(29,48,50,.07); }
    .gangue-folder > summary { list-style:none; cursor:pointer; }
    .gangue-folder > summary::-webkit-details-marker { display:none; }
    .gangue-folder:not([open]) .gangue-folder-head { border-bottom:0; }
    .gangue-folder:not([open]) { box-shadow:0 10px 34px rgba(29,48,50,.055); }
    .gangue-folder-head { display:grid; grid-template-columns:minmax(0,1fr) auto; gap:14px; padding:18px; background:linear-gradient(135deg,#ffffff,#f4faf7); border-bottom:1px solid var(--line); }
    .gangue-folder-head h3 { margin:2px 0 6px; color:var(--green); font-size:24px; }
    .gangue-folder-head p { margin:0; color:var(--muted); font-weight:800; }
    .folder-badges { display:flex; align-items:flex-start; justify-content:flex-end; gap:8px; flex-wrap:wrap; }
    .folder-badges span { min-height:32px; display:inline-flex; align-items:center; padding:0 10px; border:1px solid var(--line); border-radius:8px; background:#fff; color:var(--green); font-size:12px; font-weight:900; }
    .gangue-folder-body { display:grid; gap:16px; padding:16px; }
    .folder-section { padding:14px; border:1px solid var(--line); border-radius:8px; background:#fbfdfc; }
    .folder-section h4 { margin:0 0 10px; color:var(--green); font-size:16px; }
    .folder-section h4 small { color:var(--muted); font-weight:800; }
    .lab-gallery { display:grid; grid-template-columns:repeat(auto-fill,minmax(142px,1fr)); gap:10px; margin-top:10px; }
    .lab-photo { overflow:hidden; border:1px solid var(--line); border-radius:8px; background:#fff; }
    .lab-photo a { display:block; color:inherit; text-decoration:none; }
    .lab-photo img { width:100%; aspect-ratio:4 / 3; object-fit:cover; display:block; background:#edf4f7; }
    .lab-photo figcaption { display:grid; gap:4px; padding:9px; color:var(--ink); font-size:12px; font-weight:900; }
    .lab-photo small { color:var(--muted); font-weight:800; }
    .lab-photo form { margin:0; padding:0 9px 9px; box-shadow:none; border:0; background:transparent; }
    .lab-photo button { width:100%; min-height:32px; padding:0 8px; font-size:12px; box-shadow:none; }
    .lab-upload { display:grid; gap:10px; margin-top:10px; padding:12px; border:1px dashed #c9ddd6; border-radius:8px; background:#fff; }
    .lab-upload-grid { display:grid; grid-template-columns:minmax(0,1fr) 150px; gap:10px; }
    .lab-upload input[type=file] { background:#fff; }
    .mini-progress { display:none; gap:6px; color:var(--muted); font-size:12px; font-weight:800; }
    .mini-progress.active { display:grid; }
    .mini-progress-track { overflow:hidden; height:8px; border-radius:999px; background:#e8efed; }
    .mini-progress-bar { display:block; width:0%; height:100%; border-radius:999px; background:#337861; }
    .add-block-panel { background:#fff; }
    .add-block-panel > summary { list-style:none; cursor:pointer; }
    .add-block-panel > summary::-webkit-details-marker { display:none; }
    .add-block-panel > summary h4 { margin:0; }
    .add-block-panel[open] > summary { margin-bottom:12px; }
    .nested-block-list { display:grid; gap:12px; }
    .orphan-panel { border-color:#e4d2a8; background:#fffdf6; }
    .panel { border-color:rgba(205,220,217,.92); box-shadow:0 18px 54px rgba(29,48,50,.08); }
    .panel-title h2 { font-size:24px; }
    input, textarea, select { background:#fbfdfc; }
    button { min-height:42px; box-shadow:0 10px 24px rgba(51,120,97,.18); }
    button.secondary { border:1px solid rgba(51,120,97,.16); box-shadow:none; }
    button.danger { border:1px solid rgba(168,66,45,.14); box-shadow:none; }
    .summary-card, .today-group, .block-card, .month-card { box-shadow:0 12px 34px rgba(29,48,50,.06); }
    .block-head { background:linear-gradient(180deg,#fbfdfc,#f5faf7); }
    .task-checks { background:#fff; }
    .task-form { align-items:center; }
    .task-form input { width:19px; min-height:19px; }
    .task-form span { font-size:13px; }
    .reminder-delete-v22 { min-height:28px; padding:0 8px; margin-left:auto; border:1px solid #ead2cb; border-radius:8px; background:#fff8f4; color:#a8422d; font-size:12px; box-shadow:none; }
    .block-toolbar { grid-template-columns:minmax(0,1fr) auto auto; }
    .archive-actions { display:flex; justify-content:flex-end; gap:8px; flex-wrap:wrap; }
    .archive-actions .chip-button { min-height:36px; padding:0 12px; box-shadow:none; }
    .export-check { display:inline-flex; align-items:center; gap:7px; min-height:34px; padding:0 10px; border:1px solid var(--line); border-radius:8px; background:#fff; color:var(--green); font-size:13px; font-weight:900; }
    .export-check input { width:17px; min-height:17px; padding:0; accent-color:var(--green); }
    .block-actions { display:flex; align-items:center; justify-content:flex-end; gap:8px; flex-wrap:wrap; }
    .record-details summary { user-select:none; display:grid; grid-template-columns:minmax(0,1fr) auto; align-items:center; gap:14px; padding:14px 16px; background:#fff; transition:background .16s ease; }
    .record-details summary:hover { background:#fbfdfc; }
    .record-details summary:focus-visible { outline:3px solid rgba(51,120,97,.16); outline-offset:-3px; }
    .record-summary-main { min-width:0; display:grid !important; gap:4px; padding:0 !important; border-radius:0 !important; background:transparent !important; }
    .record-summary-main strong { color:var(--green); font-size:15px; line-height:1.2; }
    .record-summary-main em { min-width:0; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; color:var(--muted); font-style:normal; font-size:13px; font-weight:800; line-height:1.35; text-align:left; }
    .record-toggle { min-height:32px; display:inline-flex !important; align-items:center; gap:8px; padding:0 10px !important; border:1px solid var(--line); border-radius:8px !important; background:#f6faf8 !important; color:var(--green); font-size:13px; font-weight:900; white-space:nowrap; transition:background .18s ease, border-color .18s ease; }
    .record-toggle .open-label { display:none; }
    .record-details[open] .record-toggle .closed-label { display:none; }
    .record-details[open] .record-toggle .open-label { display:inline; }
    .record-toggle:after { content:""; width:8px; height:8px; border-right:2px solid var(--green); border-bottom:2px solid var(--green); transform:rotate(45deg) translate(-1px,-1px); transition:transform .18s ease; }
    .record-details[open] .record-toggle { background:#edf6f2 !important; border-color:#c7dfd6; }
    .record-details[open] .record-toggle:after { transform:rotate(225deg) translate(-1px,-1px); }
    .record-form { background:linear-gradient(180deg,#fbfdfc,#fff); }
    .record-drawer-body { border-top:1px solid var(--line); background:linear-gradient(180deg,#fbfdfc,#fff); }
    .record-tabbar { display:flex; gap:8px; flex-wrap:wrap; padding:12px 16px; border-bottom:1px solid var(--line); background:#fff; }
    .record-tabbar button { min-height:34px; padding:0 12px; border:1px solid var(--line); background:#fff; color:var(--muted); box-shadow:none; }
    .record-tabbar button.active { border-color:#c7dfd6; background:#edf6f2; color:var(--green); }
    .record-panel[hidden] { display:none; }
    .record-section { padding:16px; }
    .record-details summary:after { content:none !important; display:none !important; }
    .record-tabs { display:grid; gap:14px; }
    .recipe-note { min-height:116px; }
    .metric-options { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:8px; margin-top:8px; }
    .metric-choice { display:flex; align-items:center; gap:8px; min-height:38px; padding:8px 10px; border:1px solid var(--line); border-radius:8px; background:#fff; color:var(--ink); font-size:13px; font-weight:800; }
    .metric-choice input { width:17px; min-height:17px; padding:0; accent-color:var(--green); }
    .metric-choice span { margin:0; }
    .more-metrics { margin-top:10px; padding:10px; border:1px solid var(--line); border-radius:8px; background:#fff; }
    .more-metrics summary { cursor:pointer; color:var(--green); font-weight:900; }
    .custom-metrics { margin-top:10px; }
    .custom-material-row { display:grid; grid-template-columns:minmax(0,1fr) 150px; gap:10px; margin-top:10px; }
    .material-groups { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:12px; margin-top:8px; }
    .material-group { padding:12px; border:1px solid var(--line); border-radius:8px; background:#fff; }
    .material-group-title { display:flex; align-items:center; justify-content:space-between; gap:10px; margin-bottom:8px; color:var(--green); font-size:13px; font-weight:900; }
    .material-options { grid-template-columns:repeat(2,minmax(0,1fr)); margin-top:0; }
    .material-library-item { display:grid; grid-template-columns:minmax(0,1fr) 118px 74px; gap:8px; align-items:center; padding:8px 10px; border:1px solid var(--line); border-radius:8px; background:#fff; }
    .material-library-item.disabled { opacity:.62; background:#f7faf8; }
    .material-library-item label { display:flex; align-items:center; gap:8px; margin:0; font-size:13px; font-weight:900; }
    .material-library-item input { width:17px; min-height:17px; padding:0; accent-color:var(--green); }
    .material-library-item select { min-height:34px; padding:0 8px; font-size:12px; }
    .material-library-item button { min-height:34px; padding:0 10px; font-size:12px; box-shadow:none; }
    .recipe-field-groups { display:grid; gap:14px; }
    .recipe-field-group { padding:14px; border:1px solid var(--line); border-radius:8px; background:#fff; }
    .recipe-field-group h5 { margin:0 0 10px; color:var(--green); font-size:14px; }
    .ratio-panel { margin-top:14px; padding:14px; border:1px solid #cfe3dc; border-radius:8px; background:linear-gradient(180deg,#f8fcfa,#fff); }
    .ratio-panel strong { display:block; margin-bottom:10px; color:var(--green); }
    .ratio-grid { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:8px; }
    .ratio-grid span { display:grid; gap:4px; min-height:58px; padding:10px; border:1px solid var(--line); border-radius:8px; background:#fff; }
    .ratio-grid b { color:var(--muted); font-size:12px; }
    .ratio-grid em { color:var(--ink); font-style:normal; font-size:16px; font-weight:900; }
    .ratio-line { margin:10px 0 0; color:var(--muted); font-size:13px; font-weight:800; }
    .template-weight-panel { display:grid; gap:10px; padding:12px; border:1px solid var(--line); border-radius:8px; background:#fff; }
    .template-weight-panel strong { color:var(--green); }
    .template-weight-grid { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:8px; }
    .template-weight-grid label { display:grid; gap:5px; color:var(--muted); font-size:12px; font-weight:900; }
    .template-weight-grid input { min-height:34px; }
    .gangue-list { display:grid; gap:12px; margin-top:16px; }
    .gangue-card { border:1px solid var(--line); border-radius:8px; background:#fff; overflow:hidden; }
    .gangue-card summary { cursor:pointer; display:flex; align-items:center; justify-content:space-between; gap:12px; padding:14px 16px; list-style:none; }
    .gangue-card summary::-webkit-details-marker { display:none; }
    .gangue-card summary strong { color:var(--green); }
    .gangue-card summary span { color:var(--muted); font-size:13px; font-weight:800; }
    .gangue-form { padding:0 16px 16px; border-top:1px solid var(--line); background:#fbfdfc; }
    .gangue-range-table { width:100%; border-collapse:separate; border-spacing:0 8px; margin-top:8px; }
    .gangue-range-table th { color:var(--muted); font-size:12px; text-align:left; }
    .gangue-range-table td { padding-right:8px; }
    .gangue-range-table input { min-height:36px; }
    .gradation-list { display:grid; gap:12px; margin-top:10px; }
    .gradation-card { padding:12px; border:1px solid var(--line); border-radius:8px; background:#fff; }
    .gradation-card h5 { display:flex; align-items:center; justify-content:space-between; gap:10px; margin:0 0 10px; color:var(--green); font-size:14px; }
    .gradation-card h5 small { color:var(--muted); font-size:12px; font-weight:800; }
    .gradation-weight-table { width:100%; border-collapse:separate; border-spacing:0 8px; margin-top:8px; }
    .gradation-weight-table th { color:var(--muted); font-size:12px; text-align:left; }
    .gradation-weight-table td { padding-right:8px; }
    .gradation-weight-table input { min-height:36px; }
    .gradation-weight-table td:first-child { width:38%; }
    .gangue-crushing-summary { margin-top:8px; padding:10px 12px; border:1px solid #cfe3dc; border-radius:8px; background:#f8fcfa; color:var(--green); font-size:13px; font-weight:900; }
    .crushing-average { display:inline-flex; min-height:36px; align-items:center; padding:0 10px; border:1px solid var(--line); border-radius:8px; background:#fff; color:var(--muted); font-weight:900; }
    .crushing-average.max-crushing { border-color:#e4b04c; background:#fff8e7; color:#8a5800; }
    .gangue-preview { grid-column:1 / -1; padding:12px; border:1px solid #cfe3dc; border-radius:8px; background:#f8fcfa; color:var(--muted); font-size:13px; font-weight:800; }
    .gangue-preview strong { display:block; margin-bottom:6px; color:var(--green); }
    .gangue-preview small { display:block; margin-top:4px; color:var(--muted); }
    .library-editor textarea { min-height:72px; }
    .library-list { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:8px; }
    .library-list .metric-choice { min-height:42px; }
    .result-list { display:grid; gap:12px; }
    .result-row { padding:14px; border:1px solid var(--line); border-radius:8px; background:linear-gradient(180deg,#ffffff,#fbfdfc); }
    .result-row-title { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:12px; }
    .result-row-title strong { font-size:16px; color:var(--ink); }
    .result-row-title span { color:var(--muted); font-size:13px; font-weight:800; }
    .result-grid { grid-template-columns:repeat(4,minmax(0,1fr)); }
    .record-section h4 small { color:var(--muted); font-weight:700; }
    .site-upgrade-note { margin-top:10px; color:var(--muted); font-size:13px; }
    .dashboard-shell-v22 { min-height:100vh; background:#eef3f1; }
    .dashboard-shell-v22 main, .dashboard-shell-v22 .bar { width:auto; margin:0; }
    .app-shell-v22 { min-height:100vh; display:grid; grid-template-columns:248px minmax(0,1fr); }
    .sidebar-v22 { position:sticky; top:0; height:100vh; display:flex; flex-direction:column; gap:18px; padding:20px 16px; border-right:1px solid rgba(204,218,214,.9); background:#10211e; color:#eaf3ef; }
    .side-brand-v22 { min-height:52px; display:flex; align-items:center; gap:10px; color:#fff; text-decoration:none; }
    .side-brand-v22 span { width:38px; height:38px; display:grid; place-items:center; border-radius:8px; background:#dbe8df; color:#10211e; font-weight:900; }
    .side-brand-v22 strong { font-size:15px; line-height:1.25; }
    .sidebar-v22 nav { display:grid; gap:6px; }
    .sidebar-v22 nav a { min-height:42px; justify-content:flex-start; padding:0 12px; border:1px solid transparent; border-radius:8px; color:#b9c9c3; background:transparent; }
    .sidebar-v22 nav a:hover { border-color:rgba(255,255,255,.12); background:rgba(255,255,255,.08); color:#fff; }
    .side-foot-v22 { margin-top:auto; display:grid; gap:8px; }
    .side-foot-v22 a { min-height:36px; display:flex; align-items:center; padding:0 10px; border:1px solid rgba(255,255,255,.12); border-radius:8px; color:#dce8e3; }
    .workspace-v22 { min-width:0; }
    .topbar-v22 { position:sticky; top:0; z-index:20; min-height:82px; display:grid; grid-template-columns:minmax(260px,1fr) minmax(230px,380px) auto; gap:16px; align-items:center; padding:14px 24px; border-bottom:1px solid rgba(204,218,214,.9); background:rgba(247,250,248,.92); backdrop-filter:blur(16px); }
    .topbar-v22 h1 { margin:3px 0 0; font-size:21px; line-height:1.2; }
    .global-search-v22 { margin:0; display:grid; gap:5px; color:var(--muted); font-size:12px; font-weight:900; }
    .global-search-v22 input { min-height:42px; border-radius:8px; background:#fff; }
    .search-field-v22 { position:relative; display:grid; }
    .search-field-v22 input { padding-right:46px; }
    .search-field-v22 button { position:absolute; right:5px; top:5px; width:32px; height:32px; padding:0; border-radius:8px; border:1px solid #cbded7; background:#eef6f2; color:var(--green); font-weight:900; }
    .top-actions-v22 { display:flex; gap:8px; justify-content:flex-end; flex-wrap:wrap; }
    .top-actions-v22 a, .top-actions-v22 button, .card-actions-v22 a, .task-row-v22 a, .task-row-v22 button, .section-head-v22 > a, .gangue-summary-v22 a { min-height:38px; display:inline-flex; align-items:center; justify-content:center; padding:0 12px; border:1px solid #cbded7; border-radius:8px; background:#fff; color:var(--green); font-size:13px; font-weight:900; box-shadow:none; }
    .top-actions-v22 button { background:var(--green); color:#fff; border-color:var(--green); }
    .work-main-v22 { padding:24px; }
    .dashboard-section-v22 { scroll-margin-top:100px; margin-bottom:28px; }
    .section-title-v22 { margin:0 0 14px; }
    .section-title-v22 h2 { margin:2px 0 4px; font-size:24px; }
    .section-title-v22 p:not(.eyebrow) { color:var(--muted); font-weight:800; }
    .metric-grid-v22 { display:grid; grid-template-columns:repeat(5,minmax(0,1fr)); gap:12px; margin-bottom:16px; }
    .metric-card-v22 { position:relative; min-height:116px; padding:16px; overflow:hidden; border:1px solid rgba(204,218,214,.95); border-radius:8px; background:#fff; box-shadow:0 14px 36px rgba(20,38,35,.06); color:inherit; text-decoration:none; cursor:pointer; transition:transform .16s ease, box-shadow .16s ease, border-color .16s ease; }
    .metric-card-v22:hover, .metric-card-v22:focus-visible { transform:translateY(-2px); border-color:#9fc9bc; box-shadow:0 18px 42px rgba(20,38,35,.12); outline:none; }
    .metric-card-v22:before { content:""; position:absolute; inset:0 auto 0 0; width:5px; background:#b8c8c3; }
    .metric-card-v22 span { color:var(--muted); font-size:13px; font-weight:900; }
    .metric-card-v22 strong { display:block; margin:10px 0 8px; color:#152522; font-size:32px; line-height:1; }
    .metric-card-v22 small { display:grid; gap:6px; color:var(--muted); font-weight:800; }
    .metric-card-v22 small i { display:block; width:100%; height:6px; overflow:hidden; border-radius:999px; background:#e7efec; }
    .metric-card-v22 small i:before { content:""; display:block; width:var(--p,0%); height:100%; border-radius:999px; background:#3d6f98; }
    .metric-card-v22.danger { background:#fff8f4; border-color:#edc7ba; }
    .metric-card-v22.danger:before { background:#a8422d; }
    .metric-card-v22.danger strong { color:#a8422d; }
    .metric-card-v22.ok, .metric-card-v22.success { background:#f2faf6; border-color:#c7e5d8; }
    .metric-card-v22.ok:before, .metric-card-v22.success:before { background:#337861; }
    .metric-card-v22.ok strong, .metric-card-v22.success strong { color:#337861; }
    .metric-card-v22.info { background:#f3f8fc; border-color:#c8dcef; }
    .metric-card-v22.info:before { background:#3d6f98; }
    .metric-card-v22.info strong { color:#3d6f98; }
    .visual-insights-v22 { margin-bottom:16px; }
    .visual-map-grid-v22 { display:grid; grid-template-columns:minmax(0,1.35fr) minmax(280px,.65fr); gap:14px; align-items:start; }
    .progress-matrix-v22 { overflow:hidden; border:1px solid var(--line); border-radius:8px; background:#fbfdfc; }
    .progress-matrix-head-v22, .progress-row-v22 { display:grid; grid-template-columns:minmax(160px,1.2fr) minmax(130px,.85fr) minmax(120px,.75fr) 72px 72px; gap:10px; align-items:center; padding:10px 12px; }
    .progress-matrix-head-v22 { background:#f1f7f5; color:var(--muted); font-size:12px; font-weight:900; }
    .progress-row-v22 { min-height:58px; border-top:1px solid var(--line); color:var(--muted); text-decoration:none; font-size:13px; font-weight:850; }
    .progress-row-v22:hover, .progress-row-v22:focus-visible { background:#fff; outline:none; }
    .progress-row-v22 strong { display:grid; gap:3px; min-width:0; color:var(--ink); font-size:14px; }
    .progress-row-v22 strong small { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--muted); font-size:12px; font-weight:800; }
    .matrix-meter-v22 { display:grid; gap:5px; }
    .matrix-meter-v22 i { height:7px; overflow:hidden; border-radius:999px; background:#e4eeeb; }
    .matrix-meter-v22 i:before { content:""; display:block; width:var(--p,0%); height:100%; border-radius:999px; background:linear-gradient(90deg,#337861,#3d6f98); }
    .matrix-meter-v22 b { color:var(--green); font-size:12px; }
    .matrix-warn-v22 { color:#a8422d; }
    .age-coverage-v22 { display:grid; gap:10px; padding:14px; border:1px solid var(--line); border-radius:8px; background:#fff; }
    .age-coverage-v22 h3 { margin:0; color:var(--green); font-size:17px; }
    .age-heatmap-v23 { display:grid; gap:8px; overflow-x:auto; }
    .heatmap-head-v23, .heatmap-row-v23 { min-width:calc(220px + var(--age-cols,3) * 106px); display:grid; grid-template-columns:220px repeat(var(--age-cols,3), minmax(96px,1fr)); gap:8px; align-items:stretch; }
    .heatmap-head-v23 { color:var(--muted); font-size:12px; font-weight:900; }
    .heatmap-head-v23 span, .heatmap-head-v23 b { min-height:28px; display:flex; align-items:center; }
    .heatmap-row-v23 { text-decoration:none; color:inherit; }
    .heatmap-row-v23 strong { min-width:0; display:grid; gap:3px; padding:9px 10px; border:1px solid var(--line); border-radius:8px; background:#fbfdfc; }
    .heatmap-row-v23 strong span, .heatmap-row-v23 strong small { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .heatmap-row-v23 strong span { color:var(--ink); font-size:13px; }
    .heatmap-row-v23 strong small { color:var(--muted); font-size:11px; }
    .heat-cell-v23 { min-height:48px; display:grid; align-content:center; gap:3px; padding:7px 8px; border:1px solid var(--line); border-radius:8px; background:#f7faf8; font-style:normal; }
    .heat-cell-v23 span { color:var(--muted); font-size:12px; font-weight:900; }
    .heat-cell-v23 small { color:var(--muted); font-size:10px; font-weight:800; }
    .heat-cell-v23.done { border-color:#b8dfce; background:#edf9f3; }
    .heat-cell-v23.done span { color:#337861; }
    .heat-cell-v23.due { border-color:#f0c7ba; background:#fff3ed; }
    .heat-cell-v23.due span { color:#a8422d; }
    .heat-cell-v23.future { border-color:#c8dcef; background:#f1f7fc; }
    .heat-cell-v23.future span { color:#3d6f98; }
    .heat-cell-v23.unset { border-style:dashed; background:#f4f6f5; opacity:.78; }
    .heatmap-legend-v23 { display:flex; gap:8px; flex-wrap:wrap; margin-top:2px; }
    .heatmap-legend-v23 span { min-height:26px; display:inline-flex; align-items:center; gap:6px; padding:0 8px; border-radius:999px; background:#f7faf8; color:var(--muted); font-size:12px; font-weight:900; }
    .heatmap-legend-v23 span:before { content:""; width:8px; height:8px; border-radius:99px; background:#b8c8c3; }
    .heatmap-legend-v23 .done:before { background:#337861; }
    .heatmap-legend-v23 .due:before { background:#a8422d; }
    .heatmap-legend-v23 .future:before { background:#3d6f98; }
    .overview-grid-v22 { display:grid; grid-template-columns:minmax(0,1.16fr) minmax(360px,.84fr); gap:16px; margin-bottom:16px; align-items:start; }
    .overview-grid-v22.compact { grid-template-columns:minmax(360px,.86fr) minmax(0,1.14fr); }
    .dashboard-card-v22 { padding:18px; border:1px solid rgba(204,218,214,.95); border-radius:8px; background:#fff; box-shadow:0 14px 38px rgba(20,38,35,.065); }
    .section-head-v22 { display:flex; align-items:flex-start; justify-content:space-between; gap:14px; margin-bottom:14px; }
    .section-head-v22 h2 { margin:1px 0 4px; font-size:20px; }
    .section-head-v22 p:not(.eyebrow) { color:var(--muted); font-weight:800; line-height:1.55; }
    .empty-v22 { padding:14px; border:1px dashed #ccdcd7; border-radius:8px; background:#f8fbfa; color:var(--muted); font-weight:800; }
    .task-table-v22 { display:grid; gap:7px; }
    .task-row-v22 { display:grid; grid-template-columns:112px minmax(150px,1.2fr) minmax(120px,.9fr) 118px 92px 70px; gap:10px; align-items:center; min-height:44px; padding:9px 10px; border:1px solid var(--line); border-radius:8px; background:#fbfdfc; color:var(--muted); font-size:13px; font-weight:800; }
    .task-row-v22.head { min-height:34px; background:transparent; border:0; color:#6d7c7b; font-size:12px; }
    .task-row-v22 strong { color:var(--ink); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .task-row-v22 em { display:inline-flex; justify-content:center; min-height:28px; align-items:center; padding:0 8px; border-radius:999px; background:#eef5f2; color:var(--green); font-style:normal; font-size:12px; }
    .status-pill-v22.status-completed { background:#e7f4ee; color:#337861; }
    .status-pill-v22.status-overdue { background:#ffe6da; color:#a8422d; }
    .status-pill-v22.status-today { background:#fff0cf; color:#8a5800; }
    .status-pill-v22.status-upcoming { background:#edf4fb; color:#3d6f98; }
    .task-row-v22.overdue { border-color:#edc7ba; background:#fff8f4; }
    .task-row-v22.overdue em { background:#ffe6da; color:#a8422d; }
    .task-row-v22.today { border-color:#efd6ad; background:#fffaf0; }
    .task-row-v22.today em { background:#fff0cf; color:#8a5800; }
    .task-row-v22.upcoming em { background:#edf4fb; color:#3d6f98; }
    .task-row-v22.completed { border-color:#c7e5d8; background:#f6fbf8; opacity:.88; }
    .task-row-v22.completed em { background:#e7f4ee; color:#337861; }
    .task-action-form-v22 { margin:0; }
    .filter-v22 { display:flex; align-items:center; gap:8px; margin:0; color:var(--muted); font-size:12px; font-weight:900; }
    .chart-filter-v22 { padding:10px; border:1px solid #cbded7; border-radius:8px; background:#f8fbfa; }
    .filter-v22 select { min-height:38px; min-width:160px; background:#fff; }
    .chart-filter-v22 select { min-width:220px; font-weight:900; color:var(--green); }
    .trend-chart-v22 { display:grid; gap:11px; }
    .chart-current-v22 { margin:0; display:flex; align-items:center; justify-content:space-between; gap:10px; padding:8px 10px; border:1px solid #d7e6e0; border-radius:8px; background:#f8fbfa; color:var(--green); font-size:13px; font-weight:900; }
    .chart-current-v22 select { min-height:34px; min-width:160px; padding:0 34px 0 10px; border:1px solid #cbded7; border-radius:8px; background:#fff; color:var(--ink); font:inherit; font-size:13px; }
    .trend-row-v22 { display:grid; grid-template-columns:128px minmax(0,1fr); gap:12px; align-items:center; }
    .trend-row-v22 > strong { min-width:0; display:grid; gap:2px; color:var(--ink); font-size:13px; }
    .trend-row-v22 > strong span { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .trend-row-v22 > strong small { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--muted); font-size:11px; font-weight:900; }
    .trend-bars-v22 { display:grid; gap:6px; }
    .trend-bar-v22 { display:grid; grid-template-columns:36px minmax(0,1fr) 46px; gap:8px; align-items:center; color:var(--muted); font-size:12px; font-weight:900; }
    .trend-bar-v22 i { display:block; height:12px; overflow:hidden; border-radius:999px; background:#e8efed; }
    .trend-bar-v22 i:before { content:""; display:block; width:var(--w,0%); height:100%; border-radius:999px; background:#337861; }
    .trend-bar-v22.age-7 i:before { background:#3d6f98; }
    .trend-bar-v22.age-28 i:before { background:#d28b34; }
    .trend-bar-v22:not(.filled) i:before { background:#8eb7d6; }
    .trend-bar-v22:not(.filled) em { color:#3d6f98; }
    .anomaly-list-v22 { display:grid; gap:9px; }
    .anomaly-form-v22 { display:grid; gap:10px; }
    .anomaly-hint-v22 { color:var(--muted); font-size:13px; font-weight:800; }
    .anomaly-v22 { position:relative; touch-action:pan-y; padding:11px 96px 11px 12px; border:1px solid var(--line); border-left-width:4px; border-radius:8px; background:#fbfdfc; transition:transform .16s ease, opacity .16s ease, background .16s ease; }
    .anomaly-v22.swiping { transition:none; }
    .anomaly-v22.dismiss-ready { background:#fff1eb; }
    .anomaly-v22.dismissing { transform:translateX(-110%); opacity:0; }
    .anomaly-v22 span { display:block; color:var(--ink); font-weight:900; }
    .anomaly-v22 p { color:var(--muted); font-size:13px; font-weight:800; line-height:1.45; }
    .anomaly-v22 form { position:absolute; right:10px; top:10px; }
    .anomaly-delete-button-v22 { min-height:32px; padding:0 12px; border:1px solid #ead2cb; border-radius:8px; background:#fff8f4; color:#a8422d; font-size:12px; font-weight:900; box-shadow:none; }
    .swipe-hint-v22 { position:absolute; right:12px; bottom:9px; color:#a8422d; font-size:11px; font-style:normal; font-weight:900; opacity:.72; }
    .anomaly-v22.critical { border-left-color:#a8422d; background:#fff8f4; }
    .anomaly-v22.warning { border-left-color:#d28b34; background:#fffaf0; }
    .anomaly-v22.confirm { border-left-color:#3d6f98; background:#f3f8fc; }
    .anomaly-v22.tip { border-left-color:#b7c7c3; }
    .gangue-overview-grid-v22, .recent-block-grid-v22 { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:12px; }
    .gangue-summary-v22, .research-block-v22 { display:grid; gap:9px; padding:14px; border:1px solid var(--line); border-radius:8px; background:#fbfdfc; }
    .gangue-summary-v22 strong, .research-block-v22 h3 { color:var(--green); font-size:17px; }
    .gangue-summary-v22 span, .research-block-v22 p, .research-block-v22 small, .block-facts-v22 span { color:var(--muted); font-size:13px; font-weight:800; }
    .gangue-summary-v22 div, .card-actions-v22 { display:flex; gap:8px; flex-wrap:wrap; }
    .config-chips-v22 { display:flex; flex-wrap:wrap; gap:6px; }
    .config-chips-v22 span { min-height:26px; display:inline-flex; align-items:center; padding:0 8px; border:1px solid #d8e6e0; border-radius:999px; background:#fff; color:#44615c; font-size:12px; font-weight:900; }
    .block-facts-v22 { display:grid; gap:5px; }
    .strength-strip-v22 { display:grid; gap:7px; }
    .strength-bar-v22 { display:grid; grid-template-columns:34px minmax(0,1fr) minmax(92px,auto); gap:8px; align-items:center; color:var(--muted); font-size:12px; font-weight:900; }
    .strength-bar-v22 i { height:9px; overflow:hidden; border-radius:999px; background:#e8efed; }
    .strength-bar-v22 i:before { content:""; display:block; width:var(--w,0%); height:100%; border-radius:999px; background:#b8c8c3; }
    .strength-bar-v22.filled.age-3 i:before { background:#337861; }
    .strength-bar-v22.filled.age-7 i:before { background:#3d6f98; }
    .strength-bar-v22.filled.age-28 i:before { background:#d28b34; }
    .strength-bar-v22.due i:before { background:#d28b34; }
    .strength-bar-v22.upcoming i:before { background:#8eb7d6; }
    .strength-bar-v22.due em { color:#8a5800; }
    .strength-bar-v22.upcoming em { color:#3d6f98; }
    .strength-bar-v22 em { color:#314643; font-style:normal; text-align:right; }
    .age-progress-v22 { display:flex; gap:6px; flex-wrap:wrap; }
    .age-progress-v22 span { min-height:28px; display:inline-flex; align-items:center; padding:0 8px; border-radius:999px; background:#eef5f2; color:var(--muted); font-size:12px; font-weight:900; }
    .age-progress-v22 span.done { background:#e7f4ee; color:#337861; }
    .age-progress-v22 span.due { background:#fff0cf; color:#8a5800; }
    .age-progress-v22 span.upcoming { background:#edf4fb; color:#3d6f98; }
    .calendar-kpis { gap:8px; }
    .calendar-kpis span { min-height:68px; padding:10px 12px; border-left-width:4px; }
    .calendar-kpis .danger { border-color:#edc7ba; border-left-color:#a8422d; background:#fff8f4; }
    .calendar-kpis .today { border-color:#efd6ad; border-left-color:#d28b34; background:#fffaf0; }
    .calendar-kpis .future { border-color:#c8dcef; border-left-color:#3d6f98; background:#f3f8fc; }
    .calendar-kpis .done { border-color:#c7e5d8; border-left-color:#337861; background:#f2faf6; }
    .calendar-kpis .today b { color:#d28b34; }
    .calendar-kpis .future b { color:#3d6f98; }
    .calendar-kpis .done b { color:#337861; }
    .calendar-collapse-v22 { padding:0; overflow:hidden; }
    .calendar-collapse-v22 > summary, .create-panel-v22 > summary { cursor:pointer; list-style:none; display:flex; align-items:center; justify-content:space-between; gap:12px; padding:16px 18px; }
    .calendar-collapse-v22 > summary::-webkit-details-marker, .create-panel-v22 > summary::-webkit-details-marker { display:none; }
    .calendar-collapse-v22 summary span, .create-panel-v22 summary span { display:grid; gap:4px; }
    .calendar-collapse-v22 summary b, .create-panel-v22 summary b { color:var(--green); font-size:18px; }
    .calendar-collapse-v22 summary em, .create-panel-v22 summary em { color:var(--muted); font-style:normal; font-size:13px; font-weight:800; }
    .calendar-collapse-v22 summary strong, .create-panel-v22 summary strong { color:var(--green); font-size:13px; }
    .calendar-inner-v22 { padding:0 18px 18px; }
    .create-panel-v22 { margin-bottom:14px; }
    .create-panel-v22 form { padding:0 18px 18px; }
    .record-details[open] .record-drawer-body { position:fixed; z-index:60; top:0; right:0; bottom:0; width:min(760px, calc(100vw - 24px)); overflow:auto; border-left:1px solid var(--line); box-shadow:-28px 0 60px rgba(16,33,30,.22); }
    .record-details[open]:before { content:""; position:fixed; z-index:55; inset:0; background:rgba(16,33,30,.34); }
    .record-details[open] summary { position:relative; z-index:1; }
    .drawer-top-v22 { position:sticky; top:0; z-index:3; display:flex; justify-content:space-between; align-items:center; gap:12px; padding:14px 16px; border-bottom:1px solid var(--line); background:#fff; }
    .drawer-top-v22 strong { color:var(--green); }
    .drawer-top-v22 button { min-height:34px; padding:0 10px; box-shadow:none; }
    .metric-result-card-v22 { display:grid; gap:10px; margin-top:12px; padding:12px; border:1px solid var(--line); border-radius:8px; background:#fff; }
    .metric-result-head-v22 { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
    .metric-result-head-v22 strong { margin-right:auto; color:var(--green); }
    .source-pill-v22 { min-height:38px; display:flex; align-items:center; padding:0 10px; border:1px solid var(--line); border-radius:8px; background:#f8fbfa; color:var(--muted); font-weight:900; }
    .specimen-table-v22 { display:grid; gap:7px; overflow-x:auto; }
    .specimen-row-v22 { min-width:820px; display:grid; grid-template-columns:48px repeat(3,minmax(112px,1fr)) minmax(140px,1fr) minmax(160px,1.2fr); gap:8px; align-items:center; }
    .specimen-row-v22.head { color:var(--muted); font-size:12px; font-weight:900; }
    .specimen-row-v22 > span:first-child { color:var(--green); font-weight:900; }
    .specimen-row-v22 [data-strength-mpa] { background:#f3f8f6; color:var(--green); font-weight:900; }
    .specimen-summary-v22 { min-width:820px; display:flex; align-items:center; gap:8px; flex-wrap:wrap; padding:10px; border:1px solid #d8e6e0; border-radius:8px; background:#f8fbfa; }
    .specimen-summary-v22 span { min-height:30px; display:inline-flex; align-items:center; gap:6px; padding:0 9px; border-radius:999px; background:#fff; color:var(--muted); font-size:12px; font-weight:900; }
    .specimen-summary-v22 b { color:var(--green); }
    .specimen-summary-v22 em { color:#8a5800; font-size:12px; font-style:normal; font-weight:900; }
    .specimen-summary-v22.warn { border-color:#efd6ad; background:#fffaf0; }
    .lab-lightbox-v22 { position:fixed; z-index:100; inset:0; display:none; place-items:center; padding:24px; background:rgba(12,24,22,.86); }
    .lab-lightbox-v22.active { display:grid; }
    .lab-lightbox-v22 img { max-width:min(1180px,96vw); max-height:82vh; border-radius:8px; background:#fff; object-fit:contain; }
    .lab-lightbox-actions-v22 { position:fixed; top:18px; right:18px; display:flex; gap:8px; }
    .lab-lightbox-actions-v22 a, .lab-lightbox-actions-v22 button { min-height:40px; display:inline-flex; align-items:center; padding:0 12px; border:1px solid rgba(255,255,255,.28); border-radius:8px; background:#fff; color:#10211e; font-weight:900; box-shadow:none; }
    #material-library .panel { margin-bottom:0; }
    @media (max-width:1180px) { .app-shell-v22 { grid-template-columns:1fr; } .sidebar-v22 { position:static; height:auto; flex-direction:row; align-items:center; overflow:auto; } .sidebar-v22 nav { display:flex; flex-wrap:wrap; } .side-foot-v22 { margin-left:auto; margin-top:0; display:flex; } .topbar-v22 { grid-template-columns:1fr; } .top-actions-v22 { justify-content:flex-start; } .metric-grid-v22 { grid-template-columns:repeat(3,minmax(0,1fr)); } .overview-grid-v22, .overview-grid-v22.compact { grid-template-columns:1fr; } }
    @media (max-width:980px) { .lab-overview { grid-template-columns:1fr; } .visual-map-grid-v22 { grid-template-columns:1fr; } .result-grid, .metric-options, .ratio-grid, .stat-strip, .calendar-kpis, .calendar-agenda-list, .template-weight-grid { grid-template-columns:repeat(2,minmax(0,1fr)); } .material-groups, .library-list { grid-template-columns:1fr; } .gangue-overview-grid-v22, .recent-block-grid-v22 { grid-template-columns:repeat(2,minmax(0,1fr)); } .task-row-v22 { grid-template-columns:1fr 1fr; } .task-row-v22.head { display:none; } }
    @media (max-width:640px) { .work-main-v22 { padding:14px; } .sidebar-v22 { padding:12px; } .topbar-v22 { padding:12px 14px; } .metric-grid-v22, .gangue-overview-grid-v22, .recent-block-grid-v22 { grid-template-columns:1fr; } .workspace-hero { min-height:auto; } .progress-matrix-head-v22 { display:none; } .progress-row-v22 { grid-template-columns:1fr 1fr; align-items:start; } .progress-row-v22 strong, .matrix-meter-v22 { grid-column:1/-1; } .coverage-row-v22 { grid-template-columns:38px minmax(0,1fr) 48px; } .coverage-row-v22 em { grid-column:2/-1; text-align:left; } .gangue-folder-head, .block-toolbar, .custom-material-row, .lab-upload-grid { grid-template-columns:1fr; } .calendar-agenda-head { flex-direction:column; } .calendar-legend { justify-content:flex-start; } .folder-badges, .archive-actions, .block-actions { justify-content:stretch; } .folder-badges span, .archive-actions .chip-button, .block-actions .export-check, .block-actions button { flex:1; justify-content:center; } .viz-row { grid-template-columns:1fr; gap:5px; } .result-row-title, .gangue-card summary { align-items:flex-start; flex-direction:column; } .record-details summary { grid-template-columns:1fr; align-items:start; } .record-toggle { justify-content:center; } .record-summary-main em { white-space:normal; } .result-grid, .metric-options, .library-list, .material-options, .ratio-grid, .stat-strip, .calendar-kpis, .calendar-agenda-list, .template-weight-grid { grid-template-columns:1fr; } .material-library-item { grid-template-columns:1fr; } .side-brand-v22 strong { white-space:nowrap; } }
  `;
}

function renderTestBlocksPanelV3(content, options = {}) {
  const actionBase = options.actionBase || WORK_PATH;
  const blocks = getTestBlocks(content);
  return `<section class="work-grid" id="test-blocks">
      <article class="panel">
        <div class="panel-title">
          <div>
            <p class="eyebrow">New Record</p>
            <h2>登记试块</h2>
            <p>填好龄期后，档案会自动按龄期生成检测结果栏。</p>
          </div>
        </div>
        <form method="post" action="${actionBase}/add-block">
          <div class="form-grid">
            <label class="field wide"><span>试块名称/部位</span><input name="blockName" placeholder="例：1#楼三层梁板 C30" required></label>
            <label class="field"><span>制作日期</span><input name="madeDate" type="date" value="${today()}" required></label>
            <label class="field"><span>试块数量</span><input name="quantity" type="number" min="1" step="1" value="3" required></label>
            <label class="field"><span>强度等级</span><input name="strength" placeholder="例：C30"></label>
            <label class="field wide"><span>需要龄期</span><input id="ageInput" name="ages" value="7,28" placeholder="例：3,7,28">
              <div class="age-toolbar">
                <button class="chip-button" type="button" data-age="3">3天</button>
                <button class="chip-button" type="button" data-age="7">7天</button>
                <button class="chip-button" type="button" data-age="14">14天</button>
                <button class="chip-button" type="button" data-age="28">28天</button>
                <button class="chip-button" type="button" data-age="56">56天</button>
              </div>
            </label>
            <label class="field"><span>配方/编号</span><input name="mixName" placeholder="例：C30 泵送配合比"></label>
            <label class="field"><span>水胶比</span><input name="waterBinderRatio" placeholder="例：0.42"></label>
            <label class="field"><span>坍落度</span><input name="slump" placeholder="例：180mm"></label>
            <label class="field"><span>级配系数</span><input name="gradationCoefficient" placeholder="例：0.68"></label>
            <div class="field wide">
              <span>配方材料</span>
              ${renderRecipeMaterialSelectorV3(defaultRecipeMaterialsForContent(content), "", content.recipeMaterialLibrary, content.disabledRecipeMaterialIds)}
            </div>
            <div class="field wide">
              <span>检测指标</span>
              ${renderMetricSelectorV3(normalizeResultMetrics(DEFAULT_RESULT_METRIC_IDS), "")}
            </div>
            <label class="field wide"><span>备注</span><input name="note" placeholder="可填编号、施工段、养护条件等"></label>
          </div>
          <p class="hint">拆模提醒固定为制作日期后 1 天；龄期到期按“制作日期 + 龄期天数”计算。多个龄期用逗号分开。</p>
          <div class="actions"><button type="submit">登记试块</button></div>
        </form>
      </article>
      <article class="panel">${renderTodayFocusV3(content, actionBase, options.showMailAction)}</article>
    </section>
    ${renderCoalGangueDatabasePanelV3(content, actionBase)}
    ${renderRecipeMaterialLibraryManagerV3(content, actionBase)}
    ${options.showReminders ? renderReminderSummaryV3(content, actionBase) : ""}
    <section class="panel">${renderBlockCalendarV3(content, actionBase)}</section>
    <section class="panel">${renderBlockListV3(blocks, actionBase, content)}</section>`;
}

function blockGangueIdV3(block) {
  const record = normalizeBlockRecord(block.record, block.ages, block.metrics, block.recipeMaterials);
  return String(record.gangueAggregateId || "").trim();
}

function blocksForGangueV3(content, gangueId) {
  return getTestBlocks(content).filter((block) => blockGangueIdV3(block) === gangueId);
}

function orphanBlocksV3(content) {
  const gangueIds = new Set(getCoalGangueDb(content).map((item) => item.id));
  return getTestBlocks(content).filter((block) => {
    const id = blockGangueIdV3(block);
    return !id || !gangueIds.has(id);
  });
}

function calendarItemsForBlocksV3(blocks) {
  return blocks.flatMap((block) => [
    taskDeleted(block, "demold") ? null : {
      type: "demold",
      block,
      date: normalizeDateValue(block.demoldDate || addDays(block.madeDate, 1)),
      completed: taskCompleted(block, "demold")
    },
    ...block.ages.filter((age) => !taskDeleted(block, "age", age)).map((age) => ({
      type: "age",
      block,
      age,
      date: addDays(block.madeDate, age),
      completed: taskCompleted(block, "age", age)
    }))
  ].filter(Boolean)).sort((a, b) => a.date.localeCompare(b.date) || a.block.name.localeCompare(b.block.name) || a.type.localeCompare(b.type));
}

function taskStatsForBlocksV3(blocks) {
  const items = calendarItemsForBlocksV3(blocks);
  return {
    total: items.length,
    done: items.filter((item) => item.completed).length,
    today: items.filter((item) => !item.completed && item.date === today()).length,
    overdue: items.filter((item) => !item.completed && item.date < today()).length
  };
}

function resultStatsForBlocksV3(blocks) {
  let total = 0;
  let filled = 0;
  blocks.forEach((block) => {
    const record = normalizeBlockRecord(block.record, block.ages, block.metrics, block.recipeMaterials);
    const metrics = normalizeResultMetrics(block.metrics || record.metrics);
    block.ages.forEach((age) => {
      const row = record.results?.[String(age)] || {};
      metrics.forEach((metric) => {
        total += 1;
        if (metricResultFilled((row.metricResults || {})[metric.id])) filled += 1;
      });
    });
  });
  return { total, filled, percent: total ? Math.round((filled / total) * 100) : 0 };
}

function blockResultDueItemsV22(blocks) {
  return blocks.flatMap((block) => {
    const metrics = normalizeResultMetrics(block.metrics || (block.record && block.record.metrics), "", { fallbackToDefault: true });
    const record = normalizeBlockRecord(block.record, block.ages, metrics, block.recipeMaterials);
    return block.ages.filter((age) => !taskDeleted(block, "age", age)).flatMap((age) => {
      const dueDate = addDays(block.madeDate, age);
      const row = record.results?.[String(age)] || {};
      return metrics.map((metric) => {
        const result = normalizeMetricResultEntry((row.metricResults || {})[metric.id], (row.metrics || {})[metric.id], {
          age,
          metric: metric.id,
          dueDate
        });
        return {
          block,
          age,
          metric,
          date: dueDate,
          result,
          filled: metricResultFilled(result)
        };
      });
    });
  }).sort((a, b) => a.date.localeCompare(b.date) || a.block.name.localeCompare(b.block.name) || a.metric.label.localeCompare(b.metric.label, "zh-CN"));
}

function workspaceMetricsV22(content, referenceDate = today()) {
  const blocks = getTestBlocks(content);
  const resultItems = blockResultDueItemsV22(blocks);
  const unfilled = resultItems.filter((item) => !item.filled);
  return {
    gangues: getCoalGangueDb(content).length,
    blockGroups: blocks.length,
    dueUnrecorded: unfilled.filter((item) => item.date <= referenceDate).length,
    futurePending: unfilled.filter((item) => item.date > referenceDate && item.date <= addDays(referenceDate, 7)).length,
    resultFilled: resultItems.filter((item) => item.filled).length,
    resultTotal: resultItems.length,
    resultPercent: resultItems.length ? Math.round((resultItems.filter((item) => item.filled).length / resultItems.length) * 100) : 0
  };
}

function taskStateV22(item, referenceDate = today()) {
  const done = item.type === "result" ? item.filled === true : item.completed === true;
  if (done) return "completed";
  if (item.date < referenceDate) return "overdue";
  if (item.date === referenceDate) return "today";
  return "upcoming";
}

function taskStateLabelV22(item, referenceDate = today()) {
  const state = taskStateV22(item, referenceDate);
  if (item.type === "demold") {
    return {
      completed: "已拆模",
      overdue: "逾期拆模",
      today: "今日拆模",
      upcoming: "待拆模"
    }[state] || "拆模";
  }
  return {
    completed: "已录入",
    overdue: "逾期未录",
    today: "今日到期",
    upcoming: "未来待测"
  }[state] || "待测";
}

function visibleTaskItemsV22(content, referenceDate = today()) {
  const demoldItems = getDemoldDueItems(content)
    .filter((item) => !item.completed && item.date <= referenceDate)
    .map((item) => ({ ...item, type: "demold" }));
  const resultItems = blockResultDueItemsV22(getTestBlocks(content))
    .filter((item) => !item.filled && item.date <= referenceDate)
    .map((item) => ({ ...item, type: "result" }));
  return [...demoldItems, ...resultItems]
    .sort((a, b) => {
      const order = { overdue: 0, today: 1, upcoming: 2, completed: 3 };
      const byState = order[taskStateV22(a, referenceDate)] - order[taskStateV22(b, referenceDate)];
      return byState
        || a.date.localeCompare(b.date)
        || a.block.name.localeCompare(b.block.name, "zh-CN")
        || String(a.metric?.label || a.type).localeCompare(String(b.metric?.label || b.type), "zh-CN");
    })
    .slice(0, 10);
}

function latestMetricResultForBlockV22(block, metricId = "compressionStrength") {
  const record = normalizeBlockRecord(block.record, block.ages, block.metrics, block.recipeMaterials);
  const rows = block.ages.map((age) => {
    const row = record.results?.[String(age)] || {};
    const result = normalizeMetricResultEntry((row.metricResults || {})[metricId], (row.metrics || {})[metricId], {
      age,
      metric: metricId,
      dueDate: addDays(block.madeDate, age)
    });
    return { age, result, number: metricResultNumber(result) };
  }).filter((item) => item.number !== null);
  rows.sort((a, b) => Number(b.age) - Number(a.age));
  return rows[0] || null;
}

function compressionResultByAgeV22(block, age) {
  const record = normalizeBlockRecord(block.record, block.ages, block.metrics, block.recipeMaterials);
  const row = record.results?.[String(age)] || {};
  return normalizeMetricResultEntry((row.metricResults || {}).compressionStrength, (row.metrics || {}).compressionStrength, {
    age,
    metric: "compressionStrength",
    dueDate: addDays(block.madeDate, age)
  });
}

function chartGangueIdV22(content) {
  const gangues = getCoalGangueDb(content);
  const blocks = getTestBlocks(content);
  const withResults = gangues.map((gangue) => {
    const gangueBlocks = blocksForGangueV3(content, gangue.id);
    const latest = gangueBlocks
      .map((block) => latestMetricResultForBlockV22(block))
      .filter(Boolean)
      .sort((a, b) => String(b.result.dueDate || "").localeCompare(String(a.result.dueDate || "")))[0];
    return { gangue, count: gangueBlocks.filter((block) => latestMetricResultForBlockV22(block)).length, latestDate: latest?.result?.dueDate || "" };
  }).filter((row) => row.count > 0);
  if (withResults.length) {
    withResults.sort((a, b) => b.latestDate.localeCompare(a.latestDate) || b.count - a.count);
    return withResults[0].gangue.id;
  }
  return gangues[0]?.id || (blockGangueIdV3(blocks[0] || {}) || "");
}

function abnormalItemsV22(content, referenceDate = today()) {
  const items = [];
  const addItem = (item) => {
    const id = String(item.id || `${item.level}:${item.title}:${item.text}`)
      .replace(/[^a-zA-Z0-9:._-]+/g, "-")
      .replace(/-+/g, "-")
      .slice(0, 160);
    items.push({ ...item, id });
  };
  const blocks = getTestBlocks(content);
  const gangues = getCoalGangueDb(content);
  blockResultDueItemsV22(blocks).forEach((item) => {
    if (!item.filled && item.date <= referenceDate) {
      addItem({
        id: `due:${item.block.id}:${item.age}:${item.metric.id}`,
        level: "critical",
        title: "到期未录",
        text: `${item.block.name} · ${item.age}d ${item.metric.label} 需要记录`
      });
    }
    const cv = Number.parseFloat(String(item.result.cv || ""));
    if (item.filled && Number.isFinite(cv) && cv > 15) {
      addItem({
        id: `cv:${item.block.id}:${item.age}:${item.metric.id}`,
        level: "warning",
        title: "变异系数偏高",
        text: `${item.block.name} · ${item.age}d ${item.metric.label} CV ${item.result.cv}%`
      });
    }
  });
  gangues.forEach((gangue) => {
    if (!gangue.batchCrushingValue || (!gangue.coarseWaterAbsorption && !gangue.fineWaterAbsorption)) {
      addItem({
        id: `gangue-core:${gangue.id}`,
        level: "warning",
        title: "煤矸石关键指标缺失",
        text: `${gangue.name} 还缺压碎值或吸水率`
      });
    }
  });
  blocks.forEach((block) => {
    const images = normalizeLabImages(block.images);
    const hasAnyResult = blockResultDueItemsV22([block]).some((item) => item.filled);
    const hasCompression = blockResultDueItemsV22([block]).some((item) => item.filled && item.metric.id === "compressionStrength");
    const hasSplit = blockResultDueItemsV22([block]).some((item) => item.filled && /split|劈裂/.test(item.metric.id + item.metric.label));
    if (hasAnyResult && !images.length) {
      addItem({ id: `block-no-image:${block.id}`, level: "warning", title: "结果缺少图片", text: `${block.name} 已有结果，但还没有上传试验图片` });
    }
    if (hasCompression && !images.some((image) => ["pressureReading", "compressionFailure"].includes(image.kind))) {
      addItem({ id: `block-compression-image:${block.id}`, level: "warning", title: "抗压图片未归档", text: `${block.name} 建议上传压力读数或抗压破坏图` });
    }
    if (hasSplit && !images.some((image) => ["split", "splitSection"].includes(image.kind))) {
      addItem({ id: `block-split-image:${block.id}`, level: "warning", title: "劈裂图片未归档", text: `${block.name} 建议上传劈裂断面图` });
    }
    if (!hasAnyResult && !images.length) {
      addItem({ id: `block-empty:${block.id}`, level: "tip", title: "资料待补", text: `${block.name} 暂无强度结果和图片` });
    }
    const compressionRows = block.ages
      .map((age) => ({ age, result: compressionResultByAgeV22(block, age) }))
      .map((row) => ({ ...row, number: metricResultNumber(row.result) }))
      .filter((row) => row.number !== null)
      .sort((a, b) => a.age - b.age);
    for (let index = 1; index < compressionRows.length; index += 1) {
      const previous = compressionRows[index - 1];
      const current = compressionRows[index];
      if (current.number < previous.number * 0.95) {
        addItem({
          id: `strength-drop:${block.id}:${previous.age}:${current.age}`,
          level: "confirm",
          title: "强度回落需确认",
          text: `${block.name} ${current.age}d 低于 ${previous.age}d 的 95%，建议核对数据`
        });
      }
    }
  });
  const rank = { critical: 0, warning: 1, confirm: 2, tip: 3 };
  const dismissed = new Set(normalizeDismissedAnomalyIds(content.dismissedAnomalies));
  return items
    .filter((item) => !dismissed.has(item.id))
    .sort((a, b) => rank[a.level] - rank[b.level])
    .slice(0, 18);
}

function clampPercentV3(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(100, Math.round(number)));
}

function renderVizRowsV3(rows, options = {}) {
  if (!rows.length) return `<p class="hint">暂无可视化数据。</p>`;
  const values = rows.map((row) => Number(row.value) || 0);
  const max = Math.max(1, Number(options.max) || 0, ...values);
  return `<div class="viz-list">
      ${rows.map((row) => {
    const width = row.percent !== undefined ? clampPercentV3(row.percent) : clampPercentV3(((Number(row.value) || 0) / max) * 100);
    return `<div class="viz-row">
          <span>${html(row.label)}</span>
          <i class="viz-track"><b class="viz-fill${row.warn ? " warn" : ""}" style="--w:${width}%"></b></i>
          <strong>${html(row.text ?? row.value ?? "")}</strong>
        </div>`;
  }).join("")}
    </div>`;
}

function renderTotalVisualizationV3(content) {
  const gangues = getCoalGangueDb(content);
  const blocks = getTestBlocks(content);
  const stats = workspaceStatsV2(content);
  const resultStats = resultStatsForBlocksV3(blocks);
  const sprayCount = blocks.filter((block) => normalizeBlockCategory(block.blockCategory) === "spray").length;
  const roadCount = blocks.filter((block) => normalizeBlockCategory(block.blockCategory) === "road").length;
  const blockRows = gangues.map((item) => {
    const count = blocksForGangueV3(content, item.id).length;
    return { label: item.name, value: count, text: `${count}组` };
  }).filter((row) => row.value > 0);
  const orphanCount = orphanBlocksV3(content).length;
  if (orphanCount) blockRows.push({ label: "未归属", value: orphanCount, text: `${orphanCount}组`, warn: true });
  return `<section class="lab-overview">
      <div class="visual-panel">
        <h3>总实验可视化</h3>
        <div class="stat-strip">
          <span><b>${gangues.length}</b><small>煤矸石编号</small></span>
          <span><b>${stats.blocks}</b><small>试块编号</small></span>
          <span><b>${sprayCount}</b><small>喷浆试块</small></span>
          <span><b>${roadCount}</b><small>道路试块</small></span>
        </div>
        ${renderVizRowsV3(blockRows)}
      </div>
      <div class="visual-panel">
        <h3>提醒和结果</h3>
        ${renderVizRowsV3([
    { label: "今日提醒", value: stats.today, text: `${stats.today}`, percent: getCalendarItems(content).length ? (stats.today / Math.max(1, getCalendarItems(content).length)) * 100 : 0 },
    { label: "测试结果", value: resultStats.filled, text: `${resultStats.filled}/${resultStats.total || 0}`, percent: resultStats.percent },
    { label: "任务完成", value: stats.done, text: `${stats.done}/${getCalendarItems(content).length}`, percent: getCalendarItems(content).length ? (stats.done / getCalendarItems(content).length) * 100 : 0 },
    { label: "逾期占比", value: stats.overdue, text: `${stats.overdue}`, percent: stats.blocks ? Math.min(100, (stats.overdue / Math.max(1, getCalendarItems(content).length)) * 100) : 0, warn: stats.overdue > 0 }
  ])}
      </div>
    </section>`;
}

function renderGangueVisualizationV3(item, blocks) {
  const ranges = item.particleRanges.length ? item.particleRanges : defaultParticleRanges();
  const crushingRows = ranges.map((range) => {
    const tests = item.crushingTests?.[range] || [];
    const average = averageMeasurement(tests);
    return average === null ? null : {
      label: range,
      value: average,
      text: `${formatRecipeNumber(average, 2)}${measurementSuffix(tests)}`,
      warn: item.batchCrushingRange === range
    };
  }).filter(Boolean);
  const taskStats = taskStatsForBlocksV3(blocks);
  const resultStats = resultStatsForBlocksV3(blocks);
  return `<div class="visual-panel">
      <h3>本组矸石可视化</h3>
      <div class="stat-strip">
        <span><b>${blocks.length}</b><small>试块</small></span>
        <span><b>${item.gradations.length}</b><small>级配</small></span>
        <span><b>${taskStats.today}</b><small>今日</small></span>
        <span><b>${taskStats.overdue}</b><small>逾期</small></span>
      </div>
      ${crushingRows.length ? `<h4>压碎值平均值</h4>${renderVizRowsV3(crushingRows)}` : `<p class="hint">压碎值填三次后，这里会自动画出每个粒径的平均值。</p>`}
      <div style="margin-top:12px">
        ${renderVizRowsV3([
    { label: "测试结果", value: resultStats.filled, text: `${resultStats.filled}/${resultStats.total || 0}`, percent: resultStats.percent },
    { label: "提醒完成", value: taskStats.done, text: `${taskStats.done}/${taskStats.total || 0}`, percent: taskStats.total ? (taskStats.done / taskStats.total) * 100 : 0 }
  ])}
      </div>
    </div>`;
}

function renderLabUploadFormV3(targetType, targetId, actionBase, defaultKind = "other") {
  const kinds = labImageKindsForTarget(targetType);
  const selectedKind = kinds.some((item) => item.id === defaultKind) ? defaultKind : (kinds[0]?.id || "other");
  const typeLabel = targetType === "gangue" ? "煤矸石批次图片类型" : "试块组图片类型";
  return `<form class="lab-upload" method="post" action="${actionBase}/upload-lab-image" enctype="multipart/form-data" data-lab-upload>
      <input type="hidden" name="targetType" value="${attr(targetType)}">
      <input type="hidden" name="targetId" value="${attr(targetId)}">
      <div class="lab-upload-grid">
        <label class="field"><span>图片标题</span><input name="imageTitle" placeholder="不填就用文件名"></label>
        <label class="field"><span>${html(typeLabel)}</span><select name="imageKind">${kinds.map((item) => `<option value="${attr(item.id)}" ${item.id === selectedKind ? "selected" : ""}>${html(item.label)}</option>`).join("")}</select></label>
      </div>
      <label class="field"><span>图片说明</span><input name="imageCaption" placeholder="例：原始矸石、成型后、劈裂后、称重记录"></label>
      <input name="image" type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple required>
      <div class="mini-progress" data-upload-progress>
        <div class="mini-progress-track"><span class="mini-progress-bar" data-upload-bar></span></div>
        <span data-upload-text>准备上传</span>
      </div>
      <div class="actions"><button class="secondary" type="submit">上传图片</button></div>
    </form>`;
}

function renderLabImageGalleryV3(images, targetType, targetId, actionBase) {
  const normalized = normalizeLabImages(images);
  if (!normalized.length) return `<p class="hint">还没有上传实验图片。</p>`;
  return `<div class="lab-gallery">
      ${normalized.map((image) => `<figure class="lab-photo">
        <a href="${attr(image.src)}" data-lightbox-image data-download="${attr(image.src)}">
          <img src="${attr(image.src)}" alt="${attr(image.title || labImageKindLabel(image.kind))}" loading="lazy">
        </a>
        <figcaption>
          <strong>${html(image.title || labImageKindLabel(image.kind))}</strong>
          <small>${html(labImageKindLabel(image.kind))}${image.caption ? ` · ${html(image.caption)}` : ""}</small>
          <small><a href="${attr(image.src)}" target="_blank" rel="noopener">查看原图</a> · <a href="${attr(image.src)}" download>下载</a></small>
        </figcaption>
        <form method="post" action="${actionBase}/delete-lab-image">
          <input type="hidden" name="targetType" value="${attr(targetType)}">
          <input type="hidden" name="targetId" value="${attr(targetId)}">
          <input type="hidden" name="src" value="${attr(image.src)}">
          <button class="danger delete-lab-image" type="submit">删除图片</button>
        </form>
      </figure>`).join("")}
    </div>`;
}

function renderBlockCategorySelectV3(selected = "spray") {
  return `<label class="field"><span>试块大类</span><select name="blockCategory" data-block-category>${blockCategoryOptionsV3(selected)}</select></label>`;
}

function renderWeighingTemplateSelectV3(selected = "", category = "spray") {
  return `<label class="field"><span>称量模板</span><select name="weighingTemplate" data-weighing-template>${weighingTemplateOptionsV3(selected, category)}</select></label>`;
}

function renderGradationTemplateSelectV3(category = "spray", selected = "raw") {
  return `<label class="field"><span>级配模板</span><select name="gradationTemplate" data-gradation-template>${gradationTemplateOptionsV3(category, selected)}</select></label>`;
}

function renderBlockGradationWeightsV3(record, category = "spray") {
  const templateKey = normalizeGradationTemplate(record.gradationTemplate);
  const weights = normalizeBlockGradationWeights(record.gradationWeights, category, templateKey);
  const scheme = gradationSchemeForCategory(category);
  return `<div class="template-weight-panel" data-gradation-weight-panel>
      <strong>${html(scheme.label)} · 粒径克数</strong>
      <div class="template-weight-grid">
        ${scheme.ranges.map((range) => `<label><span>${html(range)}</span><input name="blockGradationWeight" value="${attr(weights[range])}" placeholder="g"><input type="hidden" name="blockGradationRange" value="${attr(range)}"></label>`).join("")}
      </div>
      <p class="hint">选择“原始级配”不会覆盖克数；选择 n=0.4/0.5/0.6 会按模板填入对应粒径重量。</p>
    </div>`;
}

function renderTemplateDataScriptV3() {
  const payload = {
    gradations: GRADATION_SCHEMES,
    weighing: WEIGHING_TEMPLATES,
    materialLabels: EXPERIMENT_MATERIAL_LABELS,
    materialIds: Object.fromEntries(EXPERIMENT_MATERIAL_LABELS.map((label) => [label, experimentMaterialForLabel(label)?.id || ""]))
  };
  return `<script type="application/json" id="workspace-template-data">${scriptJson(payload)}</script>`;
}

function renderGangueAddBlockFormV3(item, content, actionBase) {
  const ageId = `ages-${item.id}`;
  return `<details class="folder-section add-block-panel">
      <summary>
      <h4>新增这个煤矸石下的试块 <small>试块编号是最小实验单位</small></h4>
      </summary>
      <form method="post" action="${actionBase}/add-block">
        <input type="hidden" name="gangueAggregateId" value="${attr(item.id)}">
        <div class="form-grid">
          <label class="field wide"><span>试块编号/部位</span><input name="blockName" placeholder="例：${attr(item.name)}-01" required></label>
          ${renderBlockCategorySelectV3("road")}
          ${renderWeighingTemplateSelectV3("withoutAccelerator", "road")}
          ${renderGradationTemplateSelectV3("road", "raw")}
          <label class="field"><span>制作日期</span><input name="madeDate" type="date" value="${today()}" required></label>
          <label class="field"><span>试块数量</span><input name="quantity" type="number" min="1" step="1" value="3" required></label>
          <label class="field"><span>强度等级</span><input name="strength" placeholder="例：C30"></label>
          <label class="field wide"><span>需要龄期</span><input id="${attr(ageId)}" name="ages" value="3,7,28" placeholder="例：3,7,28">
            <div class="age-toolbar">
              ${[3, 7, 14, 28, 56].map((age) => `<button class="chip-button" type="button" data-age="${age}" data-age-target="#${attr(ageId)}">${age}天</button>`).join("")}
            </div>
          </label>
          <label class="field"><span>配方/编号</span><input name="mixName" placeholder="例：配方A"></label>
          <label class="field"><span>水胶比</span><input name="waterBinderRatio" placeholder="例：0.42"></label>
          <label class="field"><span>坍落度</span><input name="slump" placeholder="例：180mm"></label>
          <label class="field"><span>级配系数</span><input name="gradationCoefficient" placeholder="例：0.68"></label>
          <label class="field"><span>不含水总量</span><input name="totalWithoutWater" value="${attr(WEIGHING_TEMPLATES.withoutAccelerator.totalWithoutWater)}" placeholder="自动/手填"></label>
          <div class="field wide">
            <span>配方材料</span>
            ${renderRecipeMaterialSelectorV3(defaultRecipeMaterialsForContent(content), "", content.recipeMaterialLibrary, content.disabledRecipeMaterialIds)}
          </div>
          <div class="field wide">
            <span>检测指标</span>
            ${renderMetricSelectorV3(normalizeResultMetrics(DEFAULT_RESULT_METRIC_IDS), "")}
          </div>
          <div class="field wide">
            ${renderBlockGradationWeightsV3({ gradationTemplate: "raw", gradationWeights: {} }, "road")}
          </div>
          <label class="field wide"><span>备注</span><input name="note" placeholder="可填成型方式、养护条件、编号说明"></label>
        </div>
        <div class="actions"><button type="submit">登记到 ${html(item.name)}</button></div>
      </form>
    </details>`;
}

function renderGangueReminderV3(blocks, actionBase) {
  const split = splitReminderItems(calendarItemsForBlocksV3(blocks).filter((item) => !item.completed));
  return `<section class="folder-section">
      <h4>本组提醒 <small>拆模和龄期都按这个煤矸石归档</small></h4>
      <div class="summary-grid">
        ${renderReminderCardV3("今天", split.today, "age", actionBase)}
        ${renderReminderCardV3("逾期", split.overdue, "overdue", actionBase)}
        ${renderReminderCardV3("未来 7 天", split.upcoming, "upcoming", actionBase)}
      </div>
    </section>`;
}

function renderNestedBlockListV3(blocks, actionBase, content, title = "试块档案") {
  if (!blocks.length) return `<section class="folder-section"><h4>${html(title)}</h4><p class="hint">这里还没有试块。</p></section>`;
  const formId = `export-${crypto.createHash("sha1").update(blocks.map((block) => block.id).join("-")).digest("hex").slice(0, 10)}`;
  const materialLibrary = normalizeRecipeMaterialLibrary(content.recipeMaterialLibrary);
  const disabledRecipeMaterialIds = normalizeDisabledRecipeMaterialIds(content.disabledRecipeMaterialIds);
  const gangueDb = getCoalGangueDb(content);
  return `<section class="folder-section">
      <h4>${html(title)} <small>${blocks.length} 条</small></h4>
      <div class="archive-actions" style="margin-bottom:10px">
        <button class="chip-button" type="submit" form="${attr(formId)}">导出本组 Excel</button>
      </div>
      <form id="${attr(formId)}" method="post" action="${actionBase}/export-blocks">
        ${blocks.map((block) => `<input type="hidden" name="blockIds" value="${attr(block.id)}">`).join("")}
      </form>
      <div class="nested-block-list">
        ${blocks.map((block) => {
    const record = normalizeBlockRecord(block.record, block.ages, block.metrics, block.recipeMaterials);
    const dueText = block.ages.map((age) => `${age}天 ${formatDateCnV3(addDays(block.madeDate, age))}`).join("；");
    return `<article class="block-card" id="block-${attr(block.id)}" data-block-card data-search="${attr(blockSearchTextV3(block, content))}">
          <div class="block-head">
            <div>
              <div class="block-title">
                <strong>${html(block.name)}</strong>
                ${block.strength ? `<span class="badge">${html(block.strength)}</span>` : ""}
              </div>
              <div class="block-meta">
                <span>制作：${formatDateCnV3(block.madeDate)}</span>
                <span>数量：${block.quantity}块</span>
                <span>拆模：${formatDateCnV3(block.demoldDate || addDays(block.madeDate, 1))}</span>
                <span>龄期：${html(dueText || "未设置")}</span>
                ${block.note ? `<span>${html(block.note)}</span>` : ""}
              </div>
            </div>
            <div class="block-actions">
              <form class="inline-delete" method="post" action="${actionBase}/delete-block">
                <input type="hidden" name="id" value="${attr(block.id)}">
                <button class="danger delete-block" type="submit">删除</button>
              </form>
            </div>
          </div>
          ${renderBlockRecordV3(block, actionBase, materialLibrary, disabledRecipeMaterialIds, gangueDb)}
        </article>`;
  }).join("\n        ")}
      </div>
    </section>`;
}

function renderGangueExperimentFolderV3(item, content, actionBase = WORK_PATH) {
  const blocks = blocksForGangueV3(content, item.id);
  const sprayBlocks = blocks.filter((block) => normalizeBlockCategory(block.blockCategory) === "spray");
  const roadBlocks = blocks.filter((block) => normalizeBlockCategory(block.blockCategory) === "road");
  return `<details class="gangue-folder" id="gangue-${attr(item.id)}">
      <summary class="gangue-folder-head">
        <div>
          <p class="eyebrow">煤矸石编号</p>
          <h3>${html(item.name)}</h3>
          <p>${html(item.source || "未填来源")} · ${item.particleRanges.length} 个粒径 · ${item.gradations.length} 组级配</p>
        </div>
        <div class="folder-badges">
          <span>${blocks.length} 组试块</span>
          <span>${normalizeLabImages(item.images).length} 张图片</span>
          ${item.batchCrushingValue ? `<span>压碎值 ${html(item.batchCrushingValue)}</span>` : ""}
          <span class="folder-toggle">展开/收起</span>
        </div>
      </summary>
      <div class="gangue-folder-body">
        ${renderGangueVisualizationV3(item, blocks)}
        <section class="folder-section">
          <h4>矸石图片 <small>原始图、称重图、级配图</small></h4>
          ${renderLabImageGalleryV3(item.images, "gangue", item.id, actionBase)}
          ${renderLabUploadFormV3("gangue", item.id, actionBase, "gangueRaw")}
        </section>
        <section class="folder-section">
          <h4>煤矸石数据和级配 <small>粒径、压碎值、针片状、级配克数/n 值</small></h4>
          ${renderCoalGangueCardV3(item, actionBase)}
        </section>
        ${renderGangueAddBlockFormV3(item, content, actionBase)}
        ${renderNestedBlockListV3(sprayBlocks, actionBase, content, "喷浆试块")}
        ${renderNestedBlockListV3(roadBlocks, actionBase, content, "道路试块")}
      </div>
    </details>`;
}

function renderExperimentWorkspaceV3(content, actionBase = WORK_PATH) {
  const gangues = getCoalGangueDb(content);
  const orphans = orphanBlocksV3(content);
  return `<section class="lab-layout">
      <section class="panel top-calendar">${renderBlockCalendarV3(content, actionBase)}</section>
      <section class="work-grid top-work-grid">
        <article class="panel">${renderTodayFocusV3(content, actionBase, true)}</article>
        ${renderTotalVisualizationV3(content)}
      </section>
      <section class="work-grid">
        <article class="panel">
          <div class="panel-title">
            <div>
              <p class="eyebrow">New Gangue</p>
              <h2>新增煤矸石编号</h2>
              <p>先建煤矸石编号，再把级配、图片和试块都放到这个编号下面。</p>
            </div>
          </div>
          <form method="post" action="${actionBase}/add-gangue">
            <div class="form-grid">
              <label class="field"><span>煤矸石编号/名称</span><input name="gangueName" placeholder="例：G-2026-05-01 朔州水洗煤矸石" required></label>
              <label class="field"><span>来源/批次</span><input name="source" placeholder="例：朔州 XX 矿 2026-05"></label>
              <label class="field wide"><span>粒径区间</span><input name="particleRanges" value="${attr(defaultParticleRanges().join(","))}"></label>
              <label class="field"><span>粗骨料吸水率</span><input name="coarseWaterAbsorption" placeholder="例：5.2%"></label>
              <label class="field"><span>细骨料吸水率</span><input name="fineWaterAbsorption" placeholder="例：7.8%"></label>
              <label class="field"><span>粗骨料表观密度</span><input name="coarseApparentDensity" placeholder="例：2450kg/m3"></label>
              <label class="field"><span>细骨料表观密度</span><input name="fineApparentDensity" placeholder="例：2380kg/m3"></label>
              <label class="field wide"><span>其他信息</span><input name="otherInfo" placeholder="颜色、含泥量、烧失量、备注等"></label>
            </div>
            <div class="actions"><button class="secondary" type="submit">建立煤矸石档案</button></div>
          </form>
        </article>
      </section>
      <section class="gangue-folder-list">
        ${gangues.length ? gangues.map((item) => renderGangueExperimentFolderV3(item, content, actionBase)).join("") : `<article class="panel"><p class="hint">先新增一个煤矸石编号，后面的级配、图片、试块和结果都会挂到它下面。</p></article>`}
      </section>
      ${orphans.length ? `<section class="panel orphan-panel">${renderNestedBlockListV3(orphans, actionBase, content, "未归属煤矸石的旧试块")}</section>` : ""}
      ${renderRecipeMaterialLibraryManagerV3(content, actionBase)}
    </section>`;
}

function renderCoalGangueDatabasePanelV3(content, actionBase = WORK_PATH) {
  const gangueDb = getCoalGangueDb(content);
  return `<section class="panel" id="coal-gangue-db">
      <div class="panel-title">
        <div>
          <p class="eyebrow">Coal Gangue</p>
          <h2>煤矸石骨料数据库</h2>
          <p>存每种煤矸石的压碎值三次试验、针片状、吸水率、表观密度和级配堆积密度；试块档案里可以直接选择。</p>
        </div>
      </div>
      <form method="post" action="${actionBase}/add-gangue">
        <div class="form-grid">
          <label class="field"><span>煤矸石名称</span><input name="gangueName" placeholder="例：朔州水洗煤矸石" required></label>
          <label class="field"><span>来源/批次</span><input name="source" placeholder="例：朔州 XX 矿 2026-05"></label>
          <label class="field wide"><span>粒径区间</span><input name="particleRanges" value="0.3-0.6,0.6-1.18,1.18-2.36,2.36-4.75" placeholder="例：0.3-0.6,0.6-1.18,1.18-2.36,2.36-4.75"></label>
          <label class="field"><span>粗骨料吸水率</span><input name="coarseWaterAbsorption" placeholder="例：5.2%"></label>
          <label class="field"><span>细骨料吸水率</span><input name="fineWaterAbsorption" placeholder="例：7.8%"></label>
          <label class="field"><span>粗骨料表观密度</span><input name="coarseApparentDensity" placeholder="例：2450kg/m3"></label>
          <label class="field"><span>细骨料表观密度</span><input name="fineApparentDensity" placeholder="例：2380kg/m3"></label>
          <label class="field wide"><span>其他信息</span><input name="otherInfo" placeholder="颜色、烧失量、含泥量、备注等"></label>
        </div>
        <p class="hint">新增后打开该煤矸石卡片，就能按每个粒径区间填写三次压碎值和针片状含量，也能添加多个级配的松散/压紧堆积密度。</p>
        <div class="actions"><button class="secondary" type="submit">新增煤矸石</button></div>
      </form>
      <div class="gangue-list">
        ${gangueDb.length ? gangueDb.map((item) => renderCoalGangueCardV3(item, actionBase)).join("") : `<p class="hint">还没有煤矸石数据。</p>`}
      </div>
    </section>`;
}

function renderCoalGangueCardV3(item, actionBase = WORK_PATH) {
  const ranges = item.particleRanges.length ? item.particleRanges : defaultParticleRanges();
  const gradations = [...item.gradations, {}, {}, {}].slice(0, Math.max(item.gradations.length + 2, 4));
  const crushingSummary = calculateGangueCrushingSummary(item);
  return `<details class="gangue-card" id="gangue-edit-${attr(item.id)}">
      <summary>
        <strong>${html(item.name)}</strong>
        <span>${html(item.source || "未填来源")} · ${ranges.length} 个粒径区间 · ${item.gradations.length} 个级配${crushingSummary.text ? ` · 本批压碎值 ${html(crushingSummary.text)}` : ""}</span>
      </summary>
      <form class="gangue-form" method="post" action="${actionBase}/update-gangue">
        <input type="hidden" name="id" value="${attr(item.id)}">
        <div class="form-grid">
          <label class="field"><span>煤矸石名称</span><input name="gangueName" value="${attr(item.name)}" required></label>
          <label class="field"><span>来源/批次</span><input name="source" value="${attr(item.source)}"></label>
          <label class="field wide"><span>粒径区间</span><input name="particleRanges" value="${attr(ranges.join(","))}" placeholder="例：0.3-0.6,0.6-1.18,1.18-2.36,2.36-4.75"></label>
          <label class="field"><span>粗骨料吸水率</span><input name="coarseWaterAbsorption" value="${attr(item.coarseWaterAbsorption)}"></label>
          <label class="field"><span>细骨料吸水率</span><input name="fineWaterAbsorption" value="${attr(item.fineWaterAbsorption)}"></label>
          <label class="field"><span>粗骨料表观密度</span><input name="coarseApparentDensity" value="${attr(item.coarseApparentDensity)}"></label>
          <label class="field"><span>细骨料表观密度</span><input name="fineApparentDensity" value="${attr(item.fineApparentDensity)}"></label>
          <label class="field wide"><span>其他信息</span><input name="otherInfo" value="${attr(item.otherInfo)}"></label>
        </div>
        <h4>压碎值 <small>每个粒径填 3 次，自动取平均；最大平均值作为本批骨料压碎值</small></h4>
        <div class="gangue-crushing-summary">本批骨料压碎值：${crushingSummary.text ? `${html(crushingSummary.range)} 粒径 · ${html(crushingSummary.text)}` : "未计算"}</div>
        <table class="gangue-range-table">
          <thead><tr><th>粒径区间</th><th>第1次</th><th>第2次</th><th>第3次</th><th>平均值</th></tr></thead>
          <tbody>
            ${ranges.map((range) => {
    const tests = item.crushingTests[range] || ["", "", ""];
    const averageText = formatMeasurementAverage(tests);
    const isMax = crushingSummary.range === range && averageText;
    return `<tr>
              <td><input name="rangeLabel" value="${attr(range)}" readonly></td>
              <td><input name="crushingValue1" value="${attr(tests[0])}" placeholder="例：18.5%"></td>
              <td><input name="crushingValue2" value="${attr(tests[1])}" placeholder="例：18.2%"></td>
              <td><input name="crushingValue3" value="${attr(tests[2])}" placeholder="例：18.7%"></td>
              <td><span class="crushing-average${isMax ? " max-crushing" : ""}">${html(averageText || "未计算")}</span></td>
            </tr>`;
  }).join("")}
          </tbody>
        </table>
        <h4>针片状含量 <small>与压碎值分开记录</small></h4>
        <table class="gangue-range-table">
          <thead><tr><th>粒径区间</th><th>针片状含量</th></tr></thead>
          <tbody>
            ${ranges.map((range) => `<tr>
              <td><input name="flakinessRangeLabel" value="${attr(range)}" readonly></td>
              <td><input name="flakinessValue" value="${attr(item.flakinessValues[range])}" placeholder="例：7.2%"></td>
            </tr>`).join("")}
          </tbody>
        </table>
        <h4>级配堆积密度 <small>每组级配按粒径填克数和 n 值</small></h4>
        <div class="gradation-list">
          ${gradations.map((row, index) => {
    const weights = row.particleWeights || {};
    return `<section class="gradation-card">
              <h5><span>级配 ${index + 1}</span><small>${ranges.length} 个粒径</small></h5>
              <div class="form-grid">
                <label class="field"><span>级配名称</span><input name="gradationName" value="${attr(row.name)}" placeholder="例：连续级配A"></label>
                <label class="field"><span>n 值</span><input name="gradationNValue" value="${attr(row.nValue)}" placeholder="例：0.45"></label>
                <label class="field"><span>松散堆积密度</span><input name="looseBulkDensity" value="${attr(row.looseBulkDensity)}" placeholder="例：920kg/m3"></label>
                <label class="field"><span>压紧堆积密度</span><input name="compactedBulkDensity" value="${attr(row.compactedBulkDensity)}" placeholder="例：1040kg/m3"></label>
                <label class="field wide"><span>备注</span><input name="gradationNote" value="${attr(row.note)}"></label>
              </div>
              <table class="gradation-weight-table">
                <thead><tr><th>粒径区间</th><th>克数 g</th></tr></thead>
                <tbody>
                  ${ranges.map((range) => `<tr>
                    <td><input name="gradationRange_${index}" value="${attr(range)}" readonly></td>
                    <td><input name="gradationWeight_${index}" value="${attr(weights[range] || "")}" placeholder="例：250"></td>
                  </tr>`).join("")}
                </tbody>
              </table>
            </section>`;
  }).join("")}
        </div>
        <div class="actions">
          <button class="secondary" type="submit">保存煤矸石数据</button>
        </div>
      </form>
      <form class="gangue-form" method="post" action="${actionBase}/delete-gangue">
        <input type="hidden" name="id" value="${attr(item.id)}">
        <div class="actions"><button class="danger delete-gangue" type="submit">删除这条煤矸石</button></div>
      </form>
    </details>`;
}

function renderTodayFocusV3(content, actionBase = WORK_PATH, showMailAction = false) {
  const demold = splitReminderItems(getReminderItems(content, "demold"));
  const ages = splitReminderItems(getReminderItems(content, "age"));
  const todayItems = [...demold.today, ...ages.today];
  const overdueItems = [...demold.overdue, ...ages.overdue];
  return `<div class="panel-title">
        <div>
          <p class="eyebrow">Today</p>
          <h2>今日处理</h2>
          <p>做完直接勾选，邮件提醒也会避开已经完成的事项。</p>
        </div>
      </div>
      <div class="today-stack">
        <div class="today-group${overdueItems.length ? " warning" : ""}">
          <strong><span>逾期未处理</span><span>${overdueItems.length}</span></strong>
          ${overdueItems.length ? `<div class="task-list">${overdueItems.map((item) => renderTaskCheckboxV3(item, actionBase)).join("")}</div>` : `<p class="hint">没有逾期任务。</p>`}
        </div>
        <div class="today-group">
          <strong><span>今天到期</span><span>${todayItems.length}</span></strong>
          ${todayItems.length ? `<div class="task-list">${todayItems.map((item) => renderTaskCheckboxV3(item, actionBase)).join("")}</div>` : `<p class="hint">今天没有拆模或龄期任务。</p>`}
        </div>
        ${showMailAction ? `<form class="today-group" method="post" action="${actionBase}/send-reminder"><strong><span>邮件提醒</span></strong><p class="hint">每天 08:00 后自动发送今日和逾期提醒，这里也可以手动发一封当前摘要。</p><div class="actions"><button class="secondary" type="submit">立即发送提醒邮件</button></div></form>` : ""}
      </div>`;
}

function renderReminderSummaryV3(content, actionBase = WORK_PATH) {
  const demold = splitReminderItems(getReminderItems(content, "demold"));
  const ages = splitReminderItems(getReminderItems(content, "age"));
  return `<section class="panel">
      <div class="panel-title">
        <div>
          <p class="eyebrow">Reminders</p>
          <h2>提醒看板</h2>
          <p>拆模、龄期、逾期和未来 7 天安排都在这里。</p>
        </div>
      </div>
      <div class="summary-grid">
        ${renderReminderCardV3("今日拆模", demold.today, "demold", actionBase)}
        ${renderReminderCardV3("今日龄期", ages.today, "age", actionBase)}
        ${renderReminderCardV3("逾期未处理", [...demold.overdue, ...ages.overdue], "overdue", actionBase)}
      </div>
      <div class="summary-grid" style="margin-top:14px">
        ${renderReminderCardV3("未来拆模", demold.upcoming, "upcoming", actionBase)}
        ${renderReminderCardV3("未来龄期", ages.upcoming, "upcoming", actionBase)}
        ${renderReminderCardV3("全部未来 7 天", [...demold.upcoming, ...ages.upcoming], "upcoming", actionBase)}
      </div>
    </section>`;
}

function renderReminderCardV3(title, items, kind, actionBase) {
  return `<section class="summary-card ${kind === "overdue" ? "overdue" : ""} ${kind === "upcoming" ? "upcoming" : ""}">
        <strong><span>${html(title)}</span><b>${items.length}</b></strong>
        ${items.length ? `<div class="task-list">${items.map((item) => renderTaskCheckboxV3(item, actionBase)).join("")}</div>` : `<p class="hint">暂无</p>`}
      </section>`;
}

function calendarItemStateV3(item, referenceDate = today()) {
  if (calendarItemCompletedV22(item)) return "completed";
  if (item.date < referenceDate) return "overdue";
  if (item.date === referenceDate) return "today";
  return "upcoming";
}

function calendarItemCompletedV22(item) {
  return item.type === "result" ? item.filled === true : item.completed === true;
}

function workspaceCalendarItemsV22(content) {
  const demoldItems = getDemoldDueItems(content).map((item) => ({ ...item, calendarType: "demold" }));
  const ageReminderItems = getBlockDueItems(content).map((item) => ({ ...item, calendarType: "age" }));
  const resultItems = blockResultDueItemsV22(getTestBlocks(content)).map((item) => ({
    ...item,
    type: "result",
    calendarType: "result",
    completed: item.filled
  }));
  return [...demoldItems, ...ageReminderItems, ...resultItems]
    .sort((a, b) => a.date.localeCompare(b.date)
      || a.block.name.localeCompare(b.block.name, "zh-CN")
      || String(a.metric?.label || a.type).localeCompare(String(b.metric?.label || b.type), "zh-CN"));
}

function calendarStatsV3(dueItems, referenceDate = today()) {
  const incomplete = dueItems.filter((item) => !calendarItemCompletedV22(item));
  return {
    overdue: incomplete.filter((item) => item.date < referenceDate).length,
    today: incomplete.filter((item) => item.date === referenceDate).length,
    next7: incomplete.filter((item) => item.date > referenceDate && item.date <= addDays(referenceDate, 7)).length,
    next14: incomplete.filter((item) => item.date > referenceDate && item.date <= addDays(referenceDate, 14)).length,
    completed: dueItems.filter((item) => calendarItemCompletedV22(item)).length
  };
}

function renderCalendarStatsV3(dueItems, referenceDate = today()) {
  const stats = calendarStatsV3(dueItems, referenceDate);
  return `<div class="calendar-kpis">
        <span class="danger"><b>${stats.overdue}</b><small>逾期未完成</small></span>
        <span class="today"><b>${stats.today}</b><small>今天要处理</small></span>
        <span class="future"><b>${stats.next7}</b><small>未来 7 天</small></span>
        <span class="future"><b>${stats.next14}</b><small>未来 14 天</small></span>
        <span class="done"><b>${stats.completed}</b><small>已完成任务</small></span>
      </div>`;
}

function calendarAgendaItemsV3(dueItems, referenceDate = today()) {
  const end = addDays(referenceDate, 14);
  return dueItems
    .filter((item) => !calendarItemCompletedV22(item) && item.date <= end)
    .sort((a, b) => {
      const stateOrder = { overdue: 0, today: 1, upcoming: 2, completed: 3 };
      const byState = stateOrder[calendarItemStateV3(a, referenceDate)] - stateOrder[calendarItemStateV3(b, referenceDate)];
      return byState || a.date.localeCompare(b.date) || a.block.name.localeCompare(b.block.name, "zh-CN") || String(a.metric?.label || a.type).localeCompare(String(b.metric?.label || b.type), "zh-CN");
    });
}

function renderCalendarAgendaV3(dueItems, actionBase = WORK_PATH, referenceDate = today()) {
  const items = calendarAgendaItemsV3(dueItems, referenceDate);
  return `<section class="calendar-agenda">
        <div class="calendar-agenda-head">
          <div>
            <h3>接下来要做</h3>
            <p>拆模和龄期提醒可直接勾选；强度结果点击后进入对应试块录入。</p>
          </div>
          <div class="calendar-legend">
            <span class="demold">拆模</span><span class="age">龄期提醒</span><span class="result">强度结果</span><span class="overdue">逾期</span>
          </div>
        </div>
        ${items.length ? `<div class="calendar-agenda-list">${items.map((item) => renderCalendarAgendaItemV22(item, actionBase, referenceDate)).join("")}</div>` : `<p class="hint">未来 14 天没有待处理事项。</p>`}
      </section>`;
}

function renderCalendarAgendaItemV22(item, actionBase = WORK_PATH, referenceDate = today()) {
  const classes = `agenda-task ${calendarItemStateV3(item, referenceDate)}`;
  if (item.type === "result") return renderCalendarActionV22(item, actionBase, classes);
  return renderTaskCheckboxV3(item, actionBase, classes);
}

function renderBlockCalendarV3(content, actionBase = WORK_PATH) {
  const dueItems = workspaceCalendarItemsV22(content);
  const dueByDate = new Map();
  dueItems.forEach((item) => {
    if (!dueByDate.has(item.date)) dueByDate.set(item.date, []);
    dueByDate.get(item.date).push(item);
  });
  const referenceDate = today();
  const months = calendarMonths(dueItems);
  return `<div class="panel-title">
        <div>
          <p class="eyebrow">Calendar</p>
          <h2>试块日历</h2>
          <p>同一天会同时显示拆模、7天、28天等事项。</p>
        </div>
      </div>
      <div class="calendar-dashboard">
        ${renderCalendarStatsV3(dueItems, referenceDate)}
        ${renderCalendarAgendaV3(dueItems, actionBase, referenceDate)}
      </div>
      <div class="calendar-board">
        ${months.map((monthKey) => renderCalendarMonthV3(monthKey, dueByDate, actionBase, referenceDate)).join("\n        ")}
      </div>`;
}

function renderCalendarMonthV3(monthKey, dueByDate, actionBase, referenceDate = today()) {
  const [year, month] = monthKey.split("-").map(Number);
  const firstDay = new Date(Date.UTC(year, month - 1, 1));
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const blankDays = (firstDay.getUTCDay() + 6) % 7;
  const cells = [];
  for (let i = 0; i < blankDays; i += 1) cells.push(`<div class="day-cell empty"></div>`);
  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = `${monthKey}-${String(day).padStart(2, "0")}`;
    const dues = dueByDate.get(date) || [];
    const states = new Set(dues.map((item) => calendarItemStateV3(item, referenceDate)));
    const classes = ["day-cell"];
    if (date === referenceDate) classes.push("today");
    if (dues.length) classes.push("has-due");
    if (states.has("overdue")) classes.push("has-overdue");
    if (states.has("completed") && dues.every((item) => calendarItemCompletedV22(item))) classes.push("all-completed");
    cells.push(`<div class="${classes.join(" ")}">
          <span class="day-number">${day}</span>
          ${dues.map((item) => renderCalendarActionV22(item, actionBase, `due-pill ${calendarItemStateV3(item, referenceDate)}`)).join("")}
        </div>`);
  }
  return `<article class="month-card">
          <h3>${formatMonthCnV3(monthKey)}</h3>
          <div class="weekdays"><span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span><span>日</span></div>
          <div class="calendar-days">${cells.join("")}</div>
        </article>`;
}

function formatDateCnV3(dateText) {
  const date = normalizeDateValue(dateText);
  const [year, month, day] = date.split("-");
  return `${year}-${month}-${day}`;
}

function formatMonthCnV3(monthKey) {
  const [year, month] = monthKey.split("-");
  return `${year}年${Number(month)}月`;
}

function formatCalendarItemV3(item, withDate = true) {
  const prefix = withDate ? `${formatDateCnV3(item.date)} ` : "";
  const status = calendarItemCompletedV22(item) ? "已完成 · " : "";
  const suffix = `${item.block.quantity}块${item.block.strength ? ` · ${item.block.strength}` : ""}`;
  if (item.type === "demold") return `${prefix}${status}${item.block.name} · 拆模 · ${suffix}`;
  if (item.type === "result") {
    const resultText = item.filled ? ` · ${metricResultDisplay(item.result)}` : "";
    return `${prefix}${status}${item.block.name} · ${item.age}d ${item.metric.label}${resultText}`;
  }
  return `${prefix}${status}${item.block.name} · ${item.age}天 · ${suffix}`;
}

function formatCalendarPillV3(item) {
  const status = calendarItemCompletedV22(item) ? "已完成 " : "";
  if (item.type === "demold") return `${status}拆模 ${item.block.name}`;
  if (item.type === "result") return `${status}${item.age}d ${item.metric.label} ${item.block.name}`;
  return `${status}${item.age}天 ${item.block.name}`;
}

function renderCalendarActionV22(item, actionBase = WORK_PATH, extraClass = "") {
  const typeClass = item.type === "demold" ? "demold" : item.type === "result" ? "result" : "age";
  const tab = item.type === "result" ? "results" : "tasks";
  return `<a class="calendar-task-link-v22 ${extraClass} ${typeClass}${calendarItemCompletedV22(item) ? " completed" : ""}" href="#record-${attr(item.block.id)}" data-open-record="${attr(item.block.id)}" data-record-tab-target="${attr(tab)}">
          <span>${html(extraClass.split(/\s+/).includes("due-pill") ? formatCalendarPillV3(item) : formatCalendarItemV3(item, true))}</span>
        </a>`;
}

function renderTaskCheckboxV3(item, actionBase = WORK_PATH, extraClass = "") {
  const classes = extraClass.split(/\s+/).filter(Boolean);
  const compact = classes.includes("due-pill");
  const returnAnchor = classes.includes("agenda-task") || compact ? "calendar" : `record-${item.block.id}`;
  return `<form class="task-form ${extraClass} ${item.type === "demold" ? "demold" : "age"}${item.completed ? " completed" : ""}" method="post" action="${actionBase}/toggle-task">
          <input type="hidden" name="id" value="${attr(item.block.id)}">
          <input type="hidden" name="taskType" value="${attr(item.type)}">
          ${item.type === "age" ? `<input type="hidden" name="age" value="${attr(item.age)}">` : ""}
          <input type="hidden" name="returnAnchor" value="${attr(returnAnchor)}">
          <input type="checkbox" name="done" value="1" ${item.completed ? "checked" : ""} onchange="this.form.submit()" aria-label="标记完成">
          <span>${html(compact ? formatCalendarPillV3(item) : formatCalendarItemV3(item, true))}</span>
          ${compact ? "" : `<button class="reminder-delete-v22" type="submit" formaction="${actionBase}/delete-reminder" title="删除这条提醒">删除</button>`}
        </form>`;
}

function renderBlockTaskChecklistV3(block, actionBase = WORK_PATH) {
  const items = [
    taskDeleted(block, "demold") ? null : {
      type: "demold",
      block,
      date: normalizeDateValue(block.demoldDate || addDays(block.madeDate, 1)),
      completed: taskCompleted(block, "demold")
    },
    ...block.ages.filter((age) => !taskDeleted(block, "age", age)).map((age) => ({
      type: "age",
      block,
      age,
      date: addDays(block.madeDate, age),
      completed: taskCompleted(block, "age", age)
    }))
  ].filter(Boolean);
  return `<div class="task-checks">${items.map((item) => renderTaskCheckboxV3(item, actionBase)).join("")}</div>`;
}

function parseRecipeWeight(value) {
  const text = String(value || "").trim().replace(/,/g, "");
  const match = text.match(/-?\d+(?:\.\d+)?/);
  if (!match) return 0;
  const amount = Number.parseFloat(match[0]);
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  if (/kg|千克|公斤/i.test(text)) return amount * 1000;
  if (/mg|毫克/i.test(text)) return amount / 1000;
  return amount;
}

function formatRecipeNumber(value, digits = 3) {
  if (!Number.isFinite(value)) return "";
  return value.toFixed(digits).replace(/\.?0+$/, "");
}

function formatRecipeWeight(value) {
  return `${formatRecipeNumber(value, 2)}g`;
}

function calculateRecipeRatios(record) {
  const materials = normalizeRecipeMaterials(record.recipeMaterials);
  const values = normalizeRecipeValues(record.recipeValues, materials, record);
  const rows = materials.map((material) => ({
    ...material,
    category: recipeMaterialCategory(material),
    grams: parseRecipeWeight(values[material.id])
  }));
  const sumByCategory = (category) => rows
    .filter((item) => item.category === category)
    .reduce((total, item) => total + item.grams, 0);
  const binderTotal = sumByCategory("binder");
  const admixtureTotal = sumByCategory("admixture");
  const aggregateTotal = sumByCategory("aggregate");
  const waterTotal = sumByCategory("water");
  const cementWeight = rows.find((item) => item.id === "cement")?.grams || 0;
  const binderParts = rows
    .filter((item) => item.category === "binder" && item.grams > 0)
    .map((item) => ({
      label: item.label,
      grams: item.grams,
      percent: binderTotal > 0 ? item.grams / binderTotal : 0
    }));
  return {
    binderTotal,
    admixtureTotal,
    aggregateTotal,
    waterTotal,
    cementWeight,
    binderParts,
    aggregateBinderRatio: binderTotal > 0 && aggregateTotal > 0 ? aggregateTotal / binderTotal : null,
    waterBinderRatio: binderTotal > 0 && waterTotal > 0 ? waterTotal / binderTotal : null,
    waterCementRatio: cementWeight > 0 && waterTotal > 0 ? waterTotal / cementWeight : null,
    admixtureBinderPercent: binderTotal > 0 && admixtureTotal > 0 ? admixtureTotal / binderTotal : null
  };
}

function renderRecipeRatioPanelV3(record) {
  const ratios = calculateRecipeRatios(record);
  if (!ratios.binderTotal && !ratios.aggregateTotal && !ratios.waterTotal && !ratios.admixtureTotal) {
    return `<div class="ratio-panel empty"><strong>自动比例</strong><p class="hint">材料用量填 g 重后，保存档案会自动生成胶凝材料占比、骨灰比、水灰比和水胶比。</p></div>`;
  }
  const ratioItems = [
    ["胶凝总量", ratios.binderTotal ? formatRecipeWeight(ratios.binderTotal) : "未填"],
    ["外加剂总量", ratios.admixtureTotal ? formatRecipeWeight(ratios.admixtureTotal) : "未填"],
    ["骨料总量", ratios.aggregateTotal ? formatRecipeWeight(ratios.aggregateTotal) : "未填"],
    ["水总量", ratios.waterTotal ? formatRecipeWeight(ratios.waterTotal) : "未填"],
    ["骨灰比", ratios.aggregateBinderRatio ? formatRecipeNumber(ratios.aggregateBinderRatio) : "缺胶凝或骨料"],
    ["水灰比", ratios.waterCementRatio ? formatRecipeNumber(ratios.waterCementRatio) : "缺水泥或水"],
    ["水胶比", ratios.waterBinderRatio ? formatRecipeNumber(ratios.waterBinderRatio) : "缺胶凝或水"],
    ["外加剂/胶凝", ratios.admixtureBinderPercent ? `${formatRecipeNumber(ratios.admixtureBinderPercent * 100, 2)}%` : "未填"]
  ];
  const binderText = ratios.binderParts.length
    ? ratios.binderParts.map((item) => `${item.label} ${formatRecipeNumber(item.percent * 100, 2)}%`).join("，")
    : "胶凝材料还没有可计算的 g 重。";
  return `<div class="ratio-panel">
      <strong>自动比例</strong>
      <div class="ratio-grid">
        ${ratioItems.map(([label, value]) => `<span><b>${html(label)}</b><em>${html(value)}</em></span>`).join("")}
      </div>
      <p class="ratio-line">胶凝材料占比：${html(binderText)}</p>
    </div>`;
}

function blockRecordSummaryV3(record, ages = []) {
  const data = normalizeBlockRecord(record, ages);
  const metrics = normalizeResultMetrics(data.metrics);
  const recipeMaterials = normalizeRecipeMaterials(data.recipeMaterials);
  const ratios = calculateRecipeRatios(data);
  const recipeParts = [];
  if (data.mixName) recipeParts.push(`配方：${data.mixName}`);
  if (data.waterBinderRatio) recipeParts.push(`水胶比：${data.waterBinderRatio}`);
  else if (ratios.waterBinderRatio) recipeParts.push(`水胶比：${formatRecipeNumber(ratios.waterBinderRatio)}`);
  if (ratios.aggregateBinderRatio) recipeParts.push(`骨灰比：${formatRecipeNumber(ratios.aggregateBinderRatio)}`);
  if (data.slump) recipeParts.push(`坍落度：${data.slump}`);
  if (data.gradationCoefficient) recipeParts.push(`级配系数：${data.gradationCoefficient}`);
  const filledMaterials = recipeMaterials.filter((material) => data.recipeValues[material.id]).length;
  if (recipeMaterials.length) recipeParts.push(`材料：${filledMaterials}/${recipeMaterials.length} 已填`);
  const filledResults = Object.values(data.results || {}).reduce((total, item) => (
    total + Object.values(item.metricResults || {}).filter(metricResultFilled).length
  ), 0);
  const totalResults = Math.max(1, metrics.length * (ages.length || Object.keys(data.results || {}).length || 1));
  if (metrics.length) recipeParts.push(`指标：${metrics.map((metric) => metric.label).join("、")}`);
  if (filledResults) recipeParts.push(`结果：${filledResults}/${totalResults} 已填`);
  return recipeParts.length ? recipeParts.join(" · ") : "未填写配方/试验数据";
}

function renderMetricSelectorV3(metrics, customValue = "") {
  const selected = new Set(normalizeResultMetrics(metrics).map((metric) => metric.id));
  const customMetrics = customValue || normalizeResultMetrics(metrics)
    .filter((metric) => metric.custom)
    .map((metric) => metric.label)
    .join("，");
  const primary = BUILTIN_RESULT_METRICS.filter((metric) => DEFAULT_RESULT_METRIC_IDS.includes(metric.id));
  const extras = BUILTIN_RESULT_METRICS.filter((metric) => !DEFAULT_RESULT_METRIC_IDS.includes(metric.id));
  const extrasOpen = extras.some((metric) => selected.has(metric.id)) || Boolean(customMetrics);
  return `<div class="metric-options">
      ${primary.map((metric) => `<label class="metric-choice"><input type="checkbox" name="metrics" value="${attr(metric.id)}" ${selected.has(metric.id) ? "checked" : ""}><span>${html(metric.label)}</span></label>`).join("")}
    </div>
    <details class="more-metrics" ${extrasOpen ? "open" : ""}>
      <summary>更多指标</summary>
      <div class="metric-options">
        ${extras.map((metric) => `<label class="metric-choice"><input type="checkbox" name="metrics" value="${attr(metric.id)}" ${selected.has(metric.id) ? "checked" : ""}><span>${html(metric.label)}</span></label>`).join("")}
      </div>
      <label class="custom-metrics"><span>自定义指标</span><input name="customMetrics" value="${attr(customMetrics)}" placeholder="例：轴心抗压、碳化深度、回弹值"></label>
    </details>`;
}

function renderRecipeMaterialLibraryManagerV3(content, actionBase = WORK_PATH) {
  const disabled = new Set(normalizeDisabledRecipeMaterialIds(content.disabledRecipeMaterialIds));
  const enabled = new Set([
    ...BUILTIN_RECIPE_MATERIALS.filter((material) => !disabled.has(material.id)).map((material) => material.id),
    ...normalizeRecipeMaterialLibrary(content.recipeMaterialLibrary).map((material) => material.id)
  ]);
  const materials = allManagedRecipeMaterials(content);
  return `<section class="panel">
      <div class="panel-title">
        <div>
          <p class="eyebrow">Material Library</p>
          <h2>材料库管理</h2>
          <p>保留的材料会出现在新试块里；点删除只移出后续材料库，旧试块里的历史用量不会丢。</p>
        </div>
      </div>
      <form method="post" action="${actionBase}/update-material-library">
        <div class="library-list">
          ${materials.map((material) => `<div class="material-library-item${enabled.has(material.id) ? "" : " disabled"}">
            <label><input type="checkbox" name="enabledRecipeMaterials" value="${attr(material.id)}" ${enabled.has(material.id) ? "checked" : ""}><span>${html(material.label)}${enabled.has(material.id) ? "" : "（已隐藏）"}</span></label>
            <select name="materialCategory_${attr(material.id)}">${recipeMaterialCategoryOptions(recipeMaterialCategory(material))}</select>
            <button class="danger material-delete" type="submit" name="deleteRecipeMaterials" value="${attr(material.id)}">删除</button>
          </div>`).join("")}
        </div>
        <div class="custom-material-row">
          <label class="custom-metrics"><span>新增材料</span><input name="newRecipeMaterials" placeholder="例：机制砂、河砂、减水剂A、膨胀剂"></label>
          <label class="custom-metrics"><span>分类</span><select name="newRecipeMaterialCategory">${recipeMaterialCategoryOptions("binder")}</select></label>
        </div>
        <p class="hint">取消勾选是临时隐藏；点“删除”会立即从后续材料库移除。内置材料删除后会变成隐藏状态，仍可重新勾选恢复。</p>
        <div class="actions"><button class="secondary" type="submit">保存材料库</button></div>
      </form>
    </section>`;
}

function groupedRecipeMaterials(materials) {
  const groups = new Map(RECIPE_MATERIAL_CATEGORIES.map((category) => [category.id, []]));
  sortRecipeMaterials(materials).forEach((material) => {
    const category = recipeMaterialCategory(material);
    if (!groups.has(category)) groups.set(category, []);
    groups.get(category).push({ ...material, category });
  });
  return groups;
}

function renderRecipeMaterialCheckboxGroupsV3(materials, selected, inputName) {
  const groups = groupedRecipeMaterials(materials);
  return `<div class="material-groups">
      ${RECIPE_MATERIAL_CATEGORIES.map((category) => {
    const items = groups.get(category.id) || [];
    if (!items.length) return "";
    return `<section class="material-group">
          <div class="material-group-title"><span>${html(category.label)}</span><small>${items.length}项</small></div>
          <div class="metric-options material-options">
            ${items.map((material) => `<label class="metric-choice"><input type="checkbox" name="${attr(inputName)}" value="${attr(material.id)}" ${selected.has(material.id) ? "checked" : ""}><span>${html(material.label)}</span></label>`).join("")}
          </div>
        </section>`;
  }).join("")}
    </div>`;
}

function renderRecipeMaterialSelectorV3(materials, customValue = "", library = [], disabledIds = []) {
  const selected = new Set(normalizeRecipeMaterials(materials).map((material) => material.id));
  const libraryMaterials = normalizeRecipeMaterialLibrary(library);
  const options = recipeMaterialOptions(libraryMaterials, materials, disabledIds);
  const customMaterials = customValue || "";
  return `${renderRecipeMaterialCheckboxGroupsV3(options, selected, "recipeMaterials")}
    <div class="custom-material-row">
      <label class="custom-metrics"><span>新增材料</span><input name="customRecipeMaterials" value="${attr(customMaterials)}" placeholder="例：机制砂、河砂、减水剂A、膨胀剂"></label>
      <label class="custom-metrics"><span>分类</span><select name="customRecipeMaterialCategory">${recipeMaterialCategoryOptions("binder")}</select></label>
    </div>`;
}

function renderRecipeMaterialFieldsV3(record) {
  const recipeMaterials = normalizeRecipeMaterials(record.recipeMaterials);
  const recipeValues = normalizeRecipeValues(record.recipeValues, recipeMaterials, record);
  const groups = groupedRecipeMaterials(recipeMaterials);
  return `<div class="recipe-field-groups">
      ${RECIPE_MATERIAL_CATEGORIES.map((category) => {
    const items = groups.get(category.id) || [];
    if (!items.length) return "";
    return `<section class="recipe-field-group">
          <h5>${html(category.label)}</h5>
          <div class="record-grid">
            ${items.map((material) => recordFieldV3(`recipe_${material.id}`, `${material.label}（g）`, recipeValues[material.id], { placeholder: material.placeholder || "填写g重或型号" })).join("")}
          </div>
        </section>`;
  }).join("")}
      ${renderRecipeRatioPanelV3(record)}
    </div>`;
}

function renderGangueAggregateSelectorV3(gangueDb, record) {
  const selectedId = String(record.gangueAggregateId || "").trim();
  const selected = gangueDb.find((item) => item.id === selectedId);
  return `<label class="wide"><span>煤矸石骨料</span>
      <select name="gangueAggregateId">
        <option value="">不选择数据库骨料</option>
        ${gangueDb.map((item) => `<option value="${attr(item.id)}" ${item.id === selectedId ? "selected" : ""}>${html(item.name)}${item.source ? ` · ${html(item.source)}` : ""}</option>`).join("")}
      </select>
    </label>
    <div class="gangue-preview">
      <strong>${selected ? `已选：${html(selected.name)}` : "煤矸石数据库"}</strong>
      ${selected ? `${html(selected.source || "未填来源")} · 粒径区间：${html(selected.particleRanges.join("，"))}
        <small>粗/细吸水率：${html(selected.coarseWaterAbsorption || "未填")} / ${html(selected.fineWaterAbsorption || "未填")}；粗/细表观密度：${html(selected.coarseApparentDensity || "未填")} / ${html(selected.fineApparentDensity || "未填")}</small>`
    : `先在“煤矸石骨料数据库”里录入数据，之后这里就能从库里选择。`}
    </div>`;
}

function recordFieldV3(name, label, value, options = {}) {
  const type = options.type || "text";
  const placeholder = options.placeholder ? ` placeholder="${attr(options.placeholder)}"` : "";
  return `<label><span>${html(label)}</span><input name="${attr(name)}" type="${attr(type)}" value="${attr(value)}"${placeholder}></label>`;
}

function recordAreaV3(name, label, value, className = "wide") {
  return `<label class="${attr(className)}"><span>${html(label)}</span><textarea name="${attr(name)}">${html(value)}</textarea></label>`;
}

function renderAgeResultsV3(block, record) {
  const metrics = normalizeResultMetrics(block.metrics || record.metrics);
  const results = normalizeAgeResults(record, block.ages, metrics);
  return `<div class="result-list">
      ${block.ages.map((age) => {
    const key = String(age);
    const item = results[key] || {};
    const dueDate = addDays(block.madeDate, age);
    return `<section class="result-row">
          <div class="result-row-title">
            <strong>${age} 天试验结果</strong>
            <span>到期：${formatDateCnV3(dueDate)}</span>
          </div>
          <div class="record-grid result-grid">
            ${recordFieldV3(`resultTestDate_${key}`, "试验日期", item.testDate, { type: "date" })}
            ${recordAreaV3(`resultNote_${key}`, "龄期备注", item.resultNote)}
          </div>
          ${metrics.map((metric) => {
    const result = normalizeMetricResultEntry((item.metricResults || {})[metric.id], (item.metrics || {})[metric.id], {
      age,
      metric: metric.id,
      dueDate
    });
    const specimenRows = [0, 1, 2].map((index) => result.sampleMeasurements[index] || {
      pressureKn: "",
      areaMm2: "",
      strengthMpa: result.sampleValues[index] || "",
      failureMode: "",
      remark: ""
    });
    const meanDisplay = formatMpaValue(result.mean || result.manualMean) || "未录";
    const stdDisplay = result.std ? formatMpaValue(result.std) : "空";
    const manualMeanValue = result.sampleValues.length ? "" : formatMpaNumberInput(result.manualMean || result.mean);
    return `<div class="metric-result-card-v22" data-result-card data-result-label="${attr(`${age}d ${metric.label}`)}">
              <div class="metric-result-head-v22">
                <strong>${html(metric.label)}</strong>
                <span class="source-pill-v22">均值：${html(meanDisplay)}</span>
                <span class="source-pill-v22">标准差：${html(stdDisplay)}</span>
                <span class="source-pill-v22">CV：${html(result.cv ? `${result.cv}%` : "空")}</span>
                <span class="source-pill-v22">${html(result.meanSource)}</span>
              </div>
              <input type="hidden" name="manualMean_${key}_${attr(metric.id)}" value="${attr(manualMeanValue)}">
      <div class="specimen-table-v22">
                <div class="specimen-row-v22 head"><span>试件</span><span>压力 kN</span><span>受压面积 mm²</span><span>强度 MPa</span><span>破坏形态</span><span>备注</span></div>
                ${specimenRows.map((sample, index) => `<div class="specimen-row-v22" data-specimen-row>
                  <span>${index + 1}</span>
                  <input name="samplePressure_${key}_${attr(metric.id)}_${index}" value="${attr(sample.pressureKn)}" inputmode="decimal" data-pressure-kn placeholder="例：450">
                  <input name="sampleArea_${key}_${attr(metric.id)}_${index}" value="${attr(sample.areaMm2)}" inputmode="decimal" data-area-mm2 placeholder="例：22500">
                  <input name="sampleStrength_${key}_${attr(metric.id)}_${index}" value="${attr(formatMpaNumberInput(sample.strengthMpa))}" inputmode="decimal" data-strength-mpa placeholder="可手填 MPa">
                  <input name="sampleFailureMode_${key}_${attr(metric.id)}_${index}" value="${attr(sample.failureMode)}" placeholder="例：正常破坏">
                  <input name="sampleRemark_${key}_${attr(metric.id)}_${index}" value="${attr(sample.remark)}" placeholder="读数说明">
                </div>`).join("")}
                <div class="specimen-summary-v22" data-specimen-summary>
                  <span>均值 <b data-mean>${html(meanDisplay)}</b></span>
                  <span>标准差 <b data-std>${html(stdDisplay)}</b></span>
                  <span>CV <b data-cv>${html(result.cv ? `${result.cv}%` : "空")}</b></span>
                  <em data-cv-warning hidden>CV 超过 15%，建议核对试件离散性</em>
                </div>
              </div>
            </div>`;
  }).join("")}
        </section>`;
  }).join("\n      ")}
    </div>`;
}

function renderBlockRecordV3(block, actionBase = WORK_PATH, materialLibrary = [], disabledRecipeMaterialIds = [], gangueDb = []) {
  const metrics = normalizeResultMetrics(block.metrics || (block.record && block.record.metrics));
  const recipeMaterials = normalizeRecipeMaterials(block.recipeMaterials || (block.record && block.record.recipeMaterials));
  const record = normalizeBlockRecord(block.record, block.ages, metrics, recipeMaterials);
  const blockCategory = normalizeBlockCategory(block.blockCategory || inferBlockCategoryV3(block), "road");
  const weighingTemplate = normalizeWeighingTemplate(record.weighingTemplate || (blockHasAcceleratorV3(block) ? "withAccelerator" : "withoutAccelerator"), blockCategory);
  const gradationTemplate = normalizeGradationTemplate(record.gradationTemplate);
  const ageResults = normalizeAgeResults(record, block.ages, metrics);
  const existingResultLabels = block.ages.flatMap((age) => {
    const row = ageResults[String(age)] || {};
    return metrics
      .filter((metric) => metricResultFilled((row.metricResults || {})[metric.id]))
      .map((metric) => `${age}d ${metric.label}`);
  });
  return `<details class="record-details record-drawer" id="record-${attr(block.id)}" data-record-details data-record-id="${attr(block.id)}">
          <summary><span class="record-summary-main"><strong>试块档案</strong><em>${html(blockRecordSummaryV3(record, block.ages))}</em></span><span class="record-toggle" aria-hidden="true"><span class="closed-label">编辑档案</span><span class="open-label">收起</span></span></summary>
          <div class="record-drawer-body">
            <div class="drawer-top-v22"><strong>${html(block.name)}｜${html(blockCategoryLabelV3(blockCategory))}</strong><button type="button" data-close-record>关闭</button></div>
            <div class="record-tabbar" role="tablist">
              <button type="button" class="active" data-record-tab="base">基础信息</button>
              <button type="button" data-record-tab="recipe">配方</button>
              <button type="button" data-record-tab="results">测试结果</button>
              <button type="button" data-record-tab="images">图片</button>
              <button type="button" data-record-tab="tasks">提醒</button>
            </div>
            <form class="record-form" method="post" action="${actionBase}/update-block-record" data-record-form data-existing-result-labels="${attr(existingResultLabels.join("、"))}" data-original-ages="${attr(block.ages.join(","))}">
              <input type="hidden" name="id" value="${attr(block.id)}">
              <input type="hidden" name="templateApplied" value="0" data-template-applied>
              <section class="record-panel active" data-record-panel="base">
                <section class="record-section">
                  <h4>基础信息 <small>试块组是最小实验单位</small></h4>
                  <div class="record-grid">
                    <label><span>试块组编号/名称</span><input name="blockName" value="${attr(block.name)}" required></label>
                    <label><span>成型日期</span><input name="madeDate" type="date" value="${attr(block.madeDate)}" required></label>
                    <label><span>数量</span><input name="quantity" type="number" min="1" step="1" value="${attr(block.quantity)}"></label>
                    <label><span>强度等级</span><input name="strength" value="${attr(block.strength)}" placeholder="例：C30"></label>
                    <label><span>拆模日期</span><input name="demoldDate" type="date" value="${attr(block.demoldDate || addDays(block.madeDate, 1))}"></label>
                    <label><span>龄期</span><input name="ages" value="${attr(block.ages.join(","))}" placeholder="例：3,7,28"></label>
                    <label class="wide"><span>备注</span><input name="note" value="${attr(block.note)}" placeholder="成型方式、养护条件、编号说明"></label>
                  </div>
                </section>
              </section>
              <section class="record-panel" data-record-panel="recipe" hidden>
                <section class="record-section">
                  <h4>分类和模板 <small>水默认 825g，可切换有/无速凝剂</small></h4>
                  <div class="record-grid">
                    ${renderBlockCategorySelectV3(blockCategory)}
                    ${renderWeighingTemplateSelectV3(weighingTemplate, blockCategory)}
                    ${renderGradationTemplateSelectV3(blockCategory, gradationTemplate)}
                    ${recordFieldV3("totalWithoutWater", "不含水总量", record.totalWithoutWater || WEIGHING_TEMPLATES[weighingTemplate].totalWithoutWater, { placeholder: "自动/手填" })}
                    ${recordFieldV3("mixName", "配方/编号", record.mixName, { placeholder: "例：配方A" })}
                    ${recordFieldV3("gradationCoefficient", "级配系数", record.gradationCoefficient, { placeholder: "例：0.5 / raw" })}
                    ${renderGangueAggregateSelectorV3(gangueDb, record)}
                    ${recordAreaV3("recipeNote", "配方补充说明", record.recipeNote || WEIGHING_TEMPLATES[weighingTemplate].note || "", "wide recipe-note")}
                  </div>
                </section>
                <section class="record-section">
                  <h4>配方材料 <small>可从总材料库增删，旧记录数据会保留</small></h4>
                  ${renderRecipeMaterialSelectorV3(recipeMaterials, "", materialLibrary, disabledRecipeMaterialIds)}
                </section>
                <section class="record-section">
                  <h4>材料用量/型号 <small>套用模板后可继续手动改</small></h4>
                  ${renderRecipeMaterialFieldsV3({ ...record, weighingTemplate })}
                </section>
                <section class="record-section">
                  <h4>级配重量 <small>原始级配不覆盖，n 值模板自动填</small></h4>
                  ${renderBlockGradationWeightsV3(record, blockCategory)}
                </section>
              </section>
              <section class="record-panel" data-record-panel="results" hidden>
                <section class="record-section">
                  <h4>检测指标 <small>默认抗压强度，更多指标手动展开</small></h4>
                  ${renderMetricSelectorV3(metrics)}
                </section>
                <section class="record-section">
                  <h4>按龄期生成的试验结果</h4>
                  ${renderAgeResultsV3(block, record)}
                </section>
              </section>
              <div class="actions"><button class="secondary" type="submit">保存档案</button></div>
            </form>
            <section class="record-panel" data-record-panel="images" hidden>
              <section class="record-section">
                <h4>试块图片 <small>成型、养护、破型、劈裂后都可以传</small></h4>
                ${renderLabImageGalleryV3(block.images, "block", block.id, actionBase)}
                ${renderLabUploadFormV3("block", block.id, actionBase, "forming")}
              </section>
            </section>
            <section class="record-panel" data-record-panel="tasks" hidden>
              <section class="record-section">
                <h4>提醒任务 <small>完成后直接勾选</small></h4>
                ${renderBlockTaskChecklistV3(block, actionBase)}
              </section>
            </section>
          </div>
        </details>`;
}

function renderBlockListV3(blocks, actionBase = WORK_PATH, content = {}) {
  if (!blocks.length) return `<div class="panel-title"><div><p class="eyebrow">Archives</p><h2>已登记试块</h2></div></div><p class="hint">还没有登记试块。</p>`;
  const materialLibrary = normalizeRecipeMaterialLibrary(content.recipeMaterialLibrary);
  const disabledRecipeMaterialIds = normalizeDisabledRecipeMaterialIds(content.disabledRecipeMaterialIds);
  const gangueDb = getCoalGangueDb(content);
  return `<div class="panel-title">
        <div>
          <p class="eyebrow">Archives</p>
          <h2>已登记试块</h2>
          <p>每条记录都有独立配合比；打开档案后，系统会按龄期列出对应测试结果。</p>
        </div>
      </div>
      <div class="block-toolbar">
        <input id="blockSearch" type="search" placeholder="搜索名称、煤矸石、n值、粒径、材料、龄期">
        <span class="hint">共 ${blocks.length} 条</span>
        <div class="archive-actions" aria-label="试块档案批量操作">
          <button class="chip-button" type="button" data-check-all-export>全选导出</button>
          <button class="chip-button" type="button" data-clear-export>清空选择</button>
          <button class="chip-button" type="submit" form="exportBlocksForm">导出选中 Excel</button>
          <button class="chip-button" type="button" data-open-all-records>全部展开</button>
          <button class="chip-button" type="button" data-close-all-records>全部收起</button>
        </div>
      </div>
      <form id="exportBlocksForm" method="post" action="${actionBase}/export-blocks"></form>
      <div class="block-list">
        ${blocks.map((block) => {
    const record = normalizeBlockRecord(block.record, block.ages, block.metrics, block.recipeMaterials);
    const dueText = block.ages.map((age) => `${age}天 ${formatDateCnV3(addDays(block.madeDate, age))}`).join("；");
    const searchText = blockSearchTextV3(block, content);
    return `<article class="block-card" id="block-${attr(block.id)}" data-block-card data-search="${attr(searchText)}">
          <div class="block-head">
            <div>
              <div class="block-title">
                <strong>${html(block.name)}</strong>
                ${block.strength ? `<span class="badge">${html(block.strength)}</span>` : ""}
              </div>
              <div class="block-meta">
                <span>制作：${formatDateCnV3(block.madeDate)}</span>
                <span>数量：${block.quantity}块</span>
                <span>拆模：${formatDateCnV3(block.demoldDate || addDays(block.madeDate, 1))}</span>
                <span>龄期：${html(dueText || "未设置")}</span>
                ${block.note ? `<span>${html(block.note)}</span>` : ""}
              </div>
            </div>
            <div class="block-actions">
              <label class="export-check"><input form="exportBlocksForm" type="checkbox" name="blockIds" value="${attr(block.id)}" data-export-check><span>导出</span></label>
              <form class="inline-delete" method="post" action="${actionBase}/delete-block">
                <input type="hidden" name="id" value="${attr(block.id)}">
                <button class="danger delete-block" type="submit">删除</button>
              </form>
            </div>
          </div>
          ${renderBlockTaskChecklistV3(block, actionBase)}
          ${renderBlockRecordV3(block, actionBase, materialLibrary, disabledRecipeMaterialIds, gangueDb)}
        </article>`;
  }).join("\n        ")}
      </div>`;
}

function renderWorkspaceScriptV3() {
  return `<script>
    (() => {
      const templateData = (() => {
        try {
          return JSON.parse(document.getElementById("workspace-template-data")?.textContent || "{}");
        } catch {
          return {};
        }
      })();
      const escapeAttr = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
      }[char]));
      document.querySelectorAll(".message").forEach((message) => {
        message.setAttribute("role", "status");
        message.title = "点击关闭";
        message.addEventListener("click", () => message.remove());
        window.setTimeout(() => message.remove(), 4000);
      });
      const navLinks = Array.from(document.querySelectorAll(".sidebar-v22 nav a[href^='#']"));
      const setCurrentNav = (hash) => {
        const current = hash || "#overview";
        navLinks.forEach((link) => {
          const active = link.getAttribute("href") === current;
          if (active) link.setAttribute("aria-current", "page");
          else link.removeAttribute("aria-current");
        });
      };
      let closeAllRecordsForNav = () => {};
      navLinks.forEach((link) => link.addEventListener("click", (event) => {
        const targetHash = link.getAttribute("href") || "#overview";
        if (!targetHash.startsWith("#")) return;
        event.preventDefault();
        closeAllRecordsForNav();
        setCurrentNav(targetHash);
        history.pushState(null, "", location.pathname + location.search + targetHash);
        const target = document.querySelector(targetHash);
        if (target) {
          if (target.matches("details")) target.open = true;
          target.closest("details")?.setAttribute("open", "");
          window.setTimeout(() => target.scrollIntoView({ block: "start", behavior: "smooth" }), 30);
        }
      }));
      setCurrentNav(location.hash);
      window.addEventListener("hashchange", () => setCurrentNav(location.hash));
      const setOptions = (select, entries, current) => {
        if (!select || !entries) return;
        select.innerHTML = Object.entries(entries).map(([key, item]) => (
          "<option value=\\"" + escapeAttr(key) + "\\" " + (key === current ? "selected" : "") + ">" + escapeAttr(item.label || key) + "</option>"
        )).join("");
      };
      const fillGradationWeights = (scope, category, templateKey) => {
        const panel = scope.querySelector("[data-gradation-weight-panel]");
        if (!panel) return;
        const scheme = templateData.gradations?.[category] || templateData.gradations?.road;
        const template = scheme?.templates?.[templateKey] || scheme?.templates?.raw;
        const grid = panel.querySelector(".template-weight-grid");
        if (!scheme || !grid) return;
        panel.querySelector("strong").textContent = scheme.label + " · 粒径克数";
        grid.innerHTML = scheme.ranges.map((range, index) => {
          const weight = Array.isArray(template?.weights) ? (template.weights[index] ?? "") : "";
          return "<label><span>" + escapeAttr(range) + "</span><input name=\\"blockGradationWeight\\" value=\\"" + escapeAttr(weight) + "\\" placeholder=\\"g\\"><input type=\\"hidden\\" name=\\"blockGradationRange\\" value=\\"" + escapeAttr(range) + "\\"></label>";
        }).join("");
        const coefficientInput = scope.querySelector("[name='gradationCoefficient']");
        if (coefficientInput) coefficientInput.value = template?.nValue || "";
      };
      const applyWeighingTemplate = (form, templateKey) => {
        const template = templateData.weighing?.[templateKey];
        if (!template || !form) return;
        Object.values(templateData.materialIds || {}).forEach((id) => {
          const input = id ? Array.from(form.elements || []).find((element) => element.name === "recipe_" + id) : null;
          if (input) input.value = "";
        });
        Object.entries(template.values || {}).forEach(([label, amount]) => {
          const id = templateData.materialIds?.[label];
          const input = id ? Array.from(form.elements || []).find((element) => element.name === "recipe_" + id) : null;
          if (input) input.value = amount;
        });
        const total = form.querySelector("[name='totalWithoutWater']");
        if (total) total.value = template.totalWithoutWater || "";
        const applied = form.querySelector("[data-template-applied]");
        if (applied) applied.value = "1";
      };
      const syncTemplateControls = (scope, options = {}) => {
        const categorySelect = scope.querySelector("[data-block-category]");
        const weighingSelect = scope.querySelector("[data-weighing-template]");
        const gradationSelect = scope.querySelector("[data-gradation-template]");
        const category = categorySelect?.value || "spray";
        if (gradationSelect) {
          const current = options.resetGradation ? "raw" : (gradationSelect.value || "raw");
          setOptions(gradationSelect, templateData.gradations?.[category]?.templates, current);
          if (options.resetGradation || options.fillGradation) fillGradationWeights(scope, category, gradationSelect.value || current);
        }
        if (weighingSelect && options.resetWeighing) {
          weighingSelect.value = category === "spray" ? "withAccelerator" : "withoutAccelerator";
          applyWeighingTemplate(scope.tagName === "FORM" ? scope : scope.querySelector("form") || scope, weighingSelect.value);
        }
      };
      const ageInput = document.getElementById("ageInput");
      document.querySelectorAll("[data-age]").forEach((button) => {
        button.addEventListener("click", () => {
          const targetInput = button.dataset.ageTarget ? document.querySelector(button.dataset.ageTarget) : ageInput;
          if (!targetInput) return;
          const values = new Set(targetInput.value.split(/[\\s,，、]+/).map((item) => item.trim()).filter(Boolean));
          values.add(button.dataset.age);
          targetInput.value = Array.from(values).map(Number).filter(Number.isFinite).sort((a, b) => a - b).join(",");
        });
      });

      const search = document.getElementById("blockSearch");
      const globalSearch = document.getElementById("globalBlockSearch");
      const cards = Array.from(document.querySelectorAll("[data-block-card]"));
      const applySearch = (value) => {
        const keyword = String(value || "").trim().toLowerCase();
          cards.forEach((card) => {
            card.classList.toggle("hidden", Boolean(keyword) && !card.dataset.search.toLowerCase().includes(keyword));
          });
      };
      if (search) {
        search.addEventListener("input", () => {
          applySearch(search.value);
          if (globalSearch && globalSearch.value !== search.value) globalSearch.value = search.value;
        });
      }
      if (globalSearch) {
        globalSearch.addEventListener("input", () => {
          applySearch(globalSearch.value);
          if (search && search.value !== globalSearch.value) search.value = globalSearch.value;
        });
      }
      document.querySelector("[data-search-submit]")?.addEventListener("click", () => {
        if (!globalSearch) return;
        applySearch(globalSearch.value);
        globalSearch.focus();
      });
      const exportChecks = Array.from(document.querySelectorAll("[data-export-check]"));
      const normalizeResultNumber = (value) => {
        const text = String(value || "").replace(/MPa/ig, "").replace(/，/g, ".").trim();
        if (!text) return "";
        const number = Number.parseFloat(text);
        if (!Number.isFinite(number)) return "";
        return String(Math.round(number * 1000) / 1000);
      };
      const resultCardValues = (card) => {
        const sampleValues = Array.from(card.querySelectorAll("[data-strength-mpa]"))
          .map((input) => normalizeResultNumber(input.value))
          .filter(Boolean);
        if (sampleValues.length) return sampleValues;
        const manual = normalizeResultNumber(card.querySelector("[name^='manualMean_']")?.value || "");
        return manual ? [manual] : [];
      };
      const resultValuesKey = (values) => values.map((value) => normalizeResultNumber(value)).filter(Boolean).join("|");
      const resultValuesLabel = (values) => {
        const normalized = values.map((value) => normalizeResultNumber(value)).filter(Boolean);
        if (!normalized.length) return "空";
        return normalized.map((value) => value + " MPa").join(" / ");
      };
      const changedExistingResults = (form) => Array.from(form.querySelectorAll("[data-result-card]"))
        .map((card) => {
          const initial = JSON.parse(card.dataset.initialResultValues || "[]");
          if (!initial.length) return null;
          const current = resultCardValues(card);
          if (resultValuesKey(initial) === resultValuesKey(current)) return null;
          return {
            label: card.dataset.resultLabel || "测试结果",
            before: resultValuesLabel(initial),
            after: resultValuesLabel(current)
          };
        })
        .filter(Boolean);
      document.querySelectorAll("form[data-record-form]").forEach((form) => {
        form.querySelectorAll("[data-result-card]").forEach((card) => {
          card.dataset.initialResultValues = JSON.stringify(resultCardValues(card));
        });
        form.addEventListener("submit", (event) => {
          const changes = changedExistingResults(form);
          if (!changes.length) return;
          const message = "你正在修改已有强度结果：\\n"
            + changes.slice(0, 8).map((item) => item.label + "：由 " + item.before + " 改为 " + item.after).join("\\n")
            + (changes.length > 8 ? "\\n还有 " + (changes.length - 8) + " 项变化。" : "")
            + "\\n\\n新增空白结果不会提醒。确定保存这些修改吗？";
          if (!confirm(message)) event.preventDefault();
        });
      });
      document.querySelector("[data-check-all-export]")?.addEventListener("click", () => {
        exportChecks.forEach((input) => {
          const card = input.closest("[data-block-card]");
          if (!card || !card.classList.contains("hidden")) input.checked = true;
        });
      });
      document.querySelector("[data-clear-export]")?.addEventListener("click", () => {
        exportChecks.forEach((input) => { input.checked = false; });
      });
      document.getElementById("exportBlocksForm")?.addEventListener("submit", (event) => {
        const submitter = event.submitter;
        const exportAll = submitter && submitter.name === "exportAll";
        if (!exportAll && !exportChecks.some((input) => input.checked)) {
          event.preventDefault();
          alert("先勾选要导出的试块。");
        }
      });

      const recordDetails = Array.from(document.querySelectorAll("[data-record-details]"));
      const clearRecordHash = () => {
        if (/^#record-/.test(location.hash || "")) {
          history.replaceState(null, "", location.pathname + location.search);
        }
      };
      const closeRecord = (details) => {
        if (!details) return;
        details.open = false;
        clearRecordHash();
      };
      closeAllRecordsForNav = () => {
        recordDetails.forEach((details) => { details.open = false; });
        if (/^#record-/.test(location.hash || "")) {
          history.replaceState(null, "", location.pathname + location.search);
        }
      };
      const openRecord = (id, tab) => {
        const details = document.getElementById("record-" + id) || document.querySelector("[data-record-id='" + CSS.escape(id) + "']");
        if (!details) return;
        const folder = details.closest(".gangue-folder");
        if (folder) folder.open = true;
        details.open = true;
        if (tab) details.querySelector("[data-record-tab='" + CSS.escape(tab) + "']")?.click();
        if (id && location.hash !== "#record-" + id) {
          history.replaceState(null, "", location.pathname + location.search + "#record-" + id);
        }
        window.setTimeout(() => details.scrollIntoView({ block: "center", behavior: "smooth" }), 60);
      };
      recordDetails.forEach((details) => {
        const summary = details.querySelector("summary");
        summary?.setAttribute("aria-expanded", details.open ? "true" : "false");
        details.addEventListener("toggle", () => {
          summary?.setAttribute("aria-expanded", details.open ? "true" : "false");
          if (!details.open) return;
          const folder = details.closest(".gangue-folder");
          (folder ? Array.from(folder.querySelectorAll("[data-record-details]")) : recordDetails)
            .forEach((other) => { if (other !== details) other.open = false; });
        });
        details.querySelectorAll("[data-record-tab]").forEach((button) => {
          button.addEventListener("click", () => {
            const key = button.dataset.recordTab;
            details.querySelectorAll("[data-record-tab]").forEach((item) => item.classList.toggle("active", item === button));
            details.querySelectorAll("[data-record-panel]").forEach((panel) => {
              panel.hidden = panel.dataset.recordPanel !== key;
              panel.classList.toggle("active", panel.dataset.recordPanel === key);
            });
          });
        });
        details.querySelector("[data-close-record]")?.addEventListener("click", (event) => {
          event.preventDefault();
          closeRecord(details);
        });
        syncTemplateControls(details);
      });
      document.addEventListener("click", (event) => {
        const link = event.target.closest("[data-open-record]");
        if (link) {
          event.preventDefault();
          openRecord(link.dataset.openRecord, link.dataset.recordTabTarget || "");
          return;
        }
        const openDetails = document.querySelector(".record-details[open]");
        if (openDetails && !event.target.closest(".record-drawer-body") && !event.target.closest("summary")) {
          closeRecord(openDetails);
        }
      });
      const initialParams = new URLSearchParams(location.search);
      if (initialParams.get("openBlock")) openRecord(initialParams.get("openBlock"), initialParams.get("tab") || "");
      document.querySelectorAll("form").forEach((form) => {
        syncTemplateControls(form);
        form.querySelector("[data-block-category]")?.addEventListener("change", () => syncTemplateControls(form, { resetWeighing: true, resetGradation: true }));
        form.querySelector("[data-gradation-template]")?.addEventListener("change", (event) => {
          fillGradationWeights(form, form.querySelector("[data-block-category]")?.value || "spray", event.target.value);
        });
        form.querySelector("[data-weighing-template]")?.addEventListener("change", (event) => applyWeighingTemplate(form, event.target.value));
      });
      document.querySelectorAll("[data-specimen-row]").forEach((row) => {
        const pressure = row.querySelector("[data-pressure-kn]");
        const area = row.querySelector("[data-area-mm2]");
        const strength = row.querySelector("[data-strength-mpa]");
        const formatNumber = (value) => {
          if (!Number.isFinite(value)) return "";
          return String(Math.round(value * 1000) / 1000).replace(/\\.0+$/, "").replace(/(\\.\\d*?)0+$/, "$1");
        };
        const updateStrength = () => {
          const pressureValue = Number.parseFloat(String(pressure?.value || "").replace(",", "."));
          const areaValue = Number.parseFloat(String(area?.value || "").replace(",", "."));
          if (!strength || !Number.isFinite(pressureValue) || !Number.isFinite(areaValue) || areaValue <= 0) return;
          strength.value = formatNumber((pressureValue * 1000) / areaValue);
        };
        pressure?.addEventListener("input", updateStrength);
        area?.addEventListener("input", updateStrength);
        updateStrength();
      });
      const updateSpecimenSummary = (table) => {
        const values = Array.from(table.querySelectorAll("[data-strength-mpa]"))
          .map((input) => Number.parseFloat(String(input.value || "").replace(",", ".")))
          .filter(Number.isFinite);
        const summary = table.querySelector("[data-specimen-summary]");
        if (!summary) return;
        const meanSlot = summary.querySelector("[data-mean]");
        const stdSlot = summary.querySelector("[data-std]");
        const cvSlot = summary.querySelector("[data-cv]");
        const warn = summary.querySelector("[data-cv-warning]");
        if (!values.length) {
          if (meanSlot) meanSlot.textContent = "未录";
          if (stdSlot) stdSlot.textContent = "空";
          if (cvSlot) cvSlot.textContent = "空";
          if (warn) warn.hidden = true;
          summary.classList.remove("warn");
          return;
        }
        const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
        const variance = values.length > 1
          ? values.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / (values.length - 1)
          : 0;
        const std = Math.sqrt(variance);
        const cv = mean ? (std / mean) * 100 : 0;
        const fmt = (value) => String(Math.round(value * 100) / 100).replace(/\\.0+$/, "").replace(/(\\.\\d*?)0+$/, "$1");
        if (meanSlot) meanSlot.textContent = fmt(mean) + " MPa";
        if (stdSlot) stdSlot.textContent = values.length > 1 ? fmt(std) + " MPa" : "空";
        if (cvSlot) cvSlot.textContent = values.length > 1 ? fmt(cv) + "%" : "空";
        const showWarn = values.length > 1 && cv > 15;
        if (warn) warn.hidden = !showWarn;
        summary.classList.toggle("warn", showWarn);
      };
      document.querySelectorAll(".specimen-table-v22").forEach((table) => {
        table.addEventListener("input", (event) => {
          if (event.target.matches("[data-pressure-kn], [data-area-mm2], [data-strength-mpa]")) {
            window.setTimeout(() => updateSpecimenSummary(table), 0);
          }
        });
        updateSpecimenSummary(table);
      });
      const openRecordFromHash = () => {
        if (!location.hash) return;
        let targetId = "";
        try {
          targetId = decodeURIComponent(location.hash.slice(1));
        } catch {
          targetId = location.hash.slice(1);
        }
        const target = document.getElementById(targetId);
        if (!target) return;
        if (target.matches("details")) target.open = true;
        target.closest("details")?.setAttribute("open", "");
        if (/^record-/.test(targetId)) {
          const details = target.matches("[data-record-details]") ? target : null;
          if (details?.dataset.recordId) {
            openRecord(details.dataset.recordId, "");
            return;
          }
        } else {
          recordDetails.forEach((details) => { details.open = false; });
        }
        window.setTimeout(() => target.scrollIntoView({ block: "start", behavior: "smooth" }), 60);
      };
      document.querySelector("[data-open-all-records]")?.addEventListener("click", () => {
        recordDetails.forEach((details) => { details.open = true; });
      });
      document.querySelector("[data-close-all-records]")?.addEventListener("click", () => {
        recordDetails.forEach((details) => { details.open = false; });
      });
      openRecordFromHash();
      window.addEventListener("hashchange", openRecordFromHash);

      const chartData = (() => {
        try {
          return JSON.parse(document.getElementById("trend-chart-data-v22")?.textContent || "{\\"groups\\":[]}");
        } catch {
          return { groups: [] };
        }
      })();
      const chartFilter = document.querySelector("[data-chart-filter]");
      const chartStage = document.querySelector("[data-chart-stage]");
      const chartRowsSlot = document.querySelector("[data-chart-rows]");
      const chartCurrent = document.querySelector("[data-chart-current]");
      const renderChartRow = (row, max) => {
        const bars = (row.values || []).map((item) => {
          const value = Number(item.number) || 0;
          const width = value ? Math.max(4, Math.min(100, (value / Math.max(1, max)) * 100)) : 0;
          return "<span class=\\"trend-bar-v22 age-" + escapeAttr(item.age) + (value ? " filled" : "") + "\\" title=\\"" + escapeAttr(item.label || "") + "\\"><i style=\\"--w:" + width + "%\\" data-chart-bar data-chart-value=\\"" + escapeAttr(value || "") + "\\"></i><b>" + escapeAttr(item.age) + "d</b><em>" + escapeAttr(item.mean || "") + "</em></span>";
        }).join("");
        return "<article class=\\"trend-row-v22\\" data-chart-row><strong title=\\"" + escapeAttr((row.gangueName || "") + "｜" + (row.blockName || "")) + "\\"><span>" + escapeAttr(row.blockName || "") + "</span><small>" + escapeAttr(row.gangueName || "") + "</small></strong><div class=\\"trend-bars-v22\\">" + bars + "</div></article>";
      };
      const applyChartFilter = () => {
        const selected = chartFilter?.value || "";
        const group = (chartData.groups || []).find((item) => item.id === selected) || (chartData.groups || [])[0];
        if (!group || !chartRowsSlot) return;
        if (chartFilter && chartFilter.value !== group.id) chartFilter.value = group.id;
        if (chartCurrent) chartCurrent.dataset.currentName = group.name || "未命名批次";
        if (chartStage) chartStage.style.setProperty("--chart-max", group.max || 1);
        chartRowsSlot.innerHTML = (group.rows || []).length
          ? group.rows.map((row) => renderChartRow(row, group.max || 1)).join("")
          : "<p class=\\"empty-v22\\" data-chart-empty>这个批次还没有可展示的试块强度。</p>";
      };
      chartFilter?.addEventListener("change", applyChartFilter);
      applyChartFilter();

      document.querySelectorAll("[data-swipe-dismiss]").forEach((card) => {
        let startX = 0;
        let startY = 0;
        let currentX = 0;
        let tracking = false;
        let moved = false;
        const reset = () => {
          tracking = false;
          moved = false;
          currentX = 0;
          card.classList.remove("swiping", "dismiss-ready");
          card.style.transform = "";
        };
        card.addEventListener("pointerdown", (event) => {
          if (event.target.closest("button, a, input, select, textarea, form")) return;
          startX = event.clientX;
          startY = event.clientY;
          currentX = 0;
          tracking = true;
          moved = false;
          card.classList.add("swiping");
        });
        card.addEventListener("pointermove", (event) => {
          if (!tracking) return;
          const dx = event.clientX - startX;
          const dy = event.clientY - startY;
          if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 18) {
            reset();
            return;
          }
          if (dx > 6) return;
          currentX = Math.max(dx, -150);
          moved = Math.abs(currentX) > 8;
          card.style.transform = "translateX(" + currentX + "px)";
          card.classList.toggle("dismiss-ready", currentX < -86);
        });
        const finish = () => {
          if (!tracking) return;
          if (currentX < -86) {
            const form = card.querySelector("[data-dismiss-form]");
            card.classList.add("dismissing");
            window.setTimeout(() => {
              if (form?.requestSubmit) {
                form.requestSubmit();
              } else {
                form?.submit();
              }
            }, 120);
          } else {
            reset();
          }
        };
        card.addEventListener("pointerup", finish);
        card.addEventListener("pointercancel", reset);
        card.addEventListener("click", (event) => {
          if (moved) event.preventDefault();
        });
      });

      const lightbox = document.createElement("div");
      lightbox.className = "lab-lightbox-v22";
      lightbox.innerHTML = "<img alt=\\"实验原图\\"><div class=\\"lab-lightbox-actions-v22\\"><a download>下载原图</a><button type=\\"button\\">退出</button></div>";
      document.body.appendChild(lightbox);
      const lightboxImage = lightbox.querySelector("img");
      const lightboxDownload = lightbox.querySelector("a");
      const closeLightbox = () => lightbox.classList.remove("active");
      lightbox.querySelector("button")?.addEventListener("click", closeLightbox);
      lightbox.addEventListener("click", (event) => {
        if (event.target === lightbox) closeLightbox();
      });
      document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
          closeLightbox();
          recordDetails.forEach((details) => { if (details.open) details.open = false; });
        }
      });
      document.querySelectorAll("[data-lightbox-image]").forEach((link) => {
        link.addEventListener("click", (event) => {
          event.preventDefault();
          const href = link.getAttribute("href");
          if (!href) return;
          lightboxImage.src = href;
          lightboxDownload.href = href;
          lightbox.classList.add("active");
        });
      });

      document.querySelectorAll(".delete-block").forEach((button) => {
        button.addEventListener("click", (event) => {
          if (!confirm("确定删除这条试块记录吗？")) event.preventDefault();
        });
      });
      document.querySelectorAll(".delete-lab-image").forEach((button) => {
        button.addEventListener("click", (event) => {
          if (!confirm("确定删除这张实验图片吗？")) event.preventDefault();
        });
      });

      document.querySelectorAll("[data-lab-upload]").forEach((form) => {
        form.addEventListener("submit", (event) => {
          const input = form.querySelector("input[type=file]");
          const files = Array.from(input?.files || []);
          if (!files.length || !window.XMLHttpRequest) return;
          event.preventDefault();
          const progress = form.querySelector("[data-upload-progress]");
          const bar = form.querySelector("[data-upload-bar]");
          const text = form.querySelector("[data-upload-text]");
          const button = form.querySelector("button[type=submit]");
          const xhr = new XMLHttpRequest();
          xhr.open("POST", form.action);
          xhr.setRequestHeader("X-Requested-With", "XMLHttpRequest");
          if (progress) progress.classList.add("active");
          if (button) {
            button.disabled = true;
            button.textContent = "上传中...";
          }
          xhr.upload.onprogress = (progressEvent) => {
            if (!progressEvent.lengthComputable) return;
            const percent = Math.round((progressEvent.loaded / progressEvent.total) * 100);
            if (bar) bar.style.width = percent + "%";
            if (text) text.textContent = "正在上传 " + files.length + " 张图片：" + percent + "%";
          };
          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              const targetType = form.querySelector("[name='targetType']")?.value || "";
              const targetId = form.querySelector("[name='targetId']")?.value || "";
              const params = new URLSearchParams();
              params.set("msg", files.length + " 张实验图片已上传");
              if (targetType === "block" && targetId) {
                params.set("openBlock", targetId);
                params.set("tab", "images");
              }
              const hash = targetType === "block" && targetId ? "#record-" + encodeURIComponent(targetId)
                : targetType === "gangue" && targetId ? "#gangue-" + encodeURIComponent(targetId)
                  : location.hash;
              window.location.href = location.pathname + "?" + params.toString() + hash;
              return;
            }
            if (text) text.textContent = "上传失败，请重试";
            if (button) {
              button.disabled = false;
              button.textContent = "重新上传";
            }
          };
          xhr.onerror = () => {
            if (text) text.textContent = "网络中断，上传失败";
            if (button) {
              button.disabled = false;
              button.textContent = "重新上传";
            }
          };
          xhr.send(new FormData(form));
        });
      });
    })();
  </script>`;
}

function field(name, label, value) {
  return `<label>${html(label)}<input name="${attr(name)}" value="${attr(value)}"></label>`;
}

function area(name, label, value) {
  return `<label>${html(label)}<textarea name="${attr(name)}">${html(value)}</textarea></label>`;
}

function noteFields(item) {
  return `<div class="item">
    <div class="grid">
      ${field("noteDate", "日期", item.date || "")}
      ${field("noteTitle", "标题", item.title || "")}
    </div>
    ${area("noteBody", "正文", item.body || "")}
  </div>`;
}

function ideaFields(item) {
  return `<div class="item">
    <div class="grid">
      ${field("ideaTag", "标签", item.tag || "")}
      ${field("ideaTitle", "标题", item.title || "")}
    </div>
    ${area("ideaBody", "说明", item.body || "")}
  </div>`;
}

async function parseBody(req, limit = 1024 * 1024) {
  if (req._bodyBuffer) {
    if (req._bodyBuffer.length > limit) throw Object.assign(new Error("body too large"), { statusCode: 413 });
    return req._bodyBuffer;
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error("body too large"), { statusCode: 413 });
    chunks.push(chunk);
  }
  req._bodyBuffer = Buffer.concat(chunks);
  return req._bodyBuffer;
}

function contentFromForm(params, previous) {
  const pick = (name, fallback = "") => String(params.get(name) ?? fallback).trim();
  return normalizeContent({
    ...previous,
    siteTitle: pick("siteTitle", previous.siteTitle),
    brandName: pick("brandName", previous.brandName),
    eyebrow: pick("eyebrow", previous.eyebrow),
    heroTitle: pick("heroTitle", previous.heroTitle),
    lead: pick("lead", previous.lead),
    aboutKicker: pick("aboutKicker", previous.aboutKicker),
    aboutTitle: pick("aboutTitle", previous.aboutTitle),
    aboutBody: pick("aboutBody", previous.aboutBody),
    footerName: pick("footerName", previous.footerName),
    notes: zipItems(params.getAll("noteDate"), params.getAll("noteTitle"), params.getAll("noteBody"), ["date", "title", "body"]),
    ideas: zipItems(params.getAll("ideaTag"), params.getAll("ideaTitle"), params.getAll("ideaBody"), ["tag", "title", "body"])
  });
}

function zipItems(a, b, c, keys) {
  const max = Math.max(a.length, b.length, c.length);
  const items = [];
  for (let i = 0; i < max; i += 1) {
    const item = {
      [keys[0]]: String(a[i] || "").trim(),
      [keys[1]]: String(b[i] || "").trim(),
      [keys[2]]: String(c[i] || "").trim()
    };
    if (Object.values(item).some(Boolean)) items.push(item);
  }
  return items;
}

function parseMultipart(buffer, contentType) {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || "");
  if (!match) throw Object.assign(new Error("missing multipart boundary"), { statusCode: 400 });
  const boundary = Buffer.from(`--${match[1] || match[2]}`);
  const parts = [];
  let start = buffer.indexOf(boundary);
  while (start !== -1) {
    start += boundary.length;
    if (buffer[start] === 45 && buffer[start + 1] === 45) break;
    if (buffer[start] === 13 && buffer[start + 1] === 10) start += 2;
    const end = buffer.indexOf(boundary, start);
    if (end === -1) break;
    const raw = buffer.subarray(start, end - 2);
    const split = raw.indexOf(Buffer.from("\r\n\r\n"));
    if (split !== -1) {
      const headerText = raw.subarray(0, split).toString("utf8");
      const body = raw.subarray(split + 4);
      const name = /name="([^"]+)"/.exec(headerText)?.[1];
      const filename = /filename="([^"]*)"/.exec(headerText)?.[1] || "";
      const type = /Content-Type:\s*([^\r\n]+)/i.exec(headerText)?.[1]?.trim() || "";
      if (name) parts.push({ name, filename, type, body });
    }
    start = end;
  }
  return parts;
}

function redirect(res, message = "", basePath = BASE_PATH, hash = "") {
  const suffix = message ? `?msg=${encodeURIComponent(message)}` : "";
  const anchor = hash ? `#${encodeURIComponent(String(hash).replace(/^#/, ""))}` : "";
  res.writeHead(303, { Location: `${basePath}/${suffix}${anchor}` });
  res.end();
}

function safeReturnAnchor(value, fallback = "calendar") {
  const anchor = String(value || "").trim().replace(/^#/, "");
  return /^[A-Za-z0-9:_-]{1,96}$/.test(anchor) ? anchor : fallback;
}

function send(res, status, body, type = "text/html; charset=utf-8") {
  res.writeHead(status, {
    "Content-Type": type,
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "no-store"
  });
  res.end(body);
}

function sendProtectedHtml(req, res, status, body) {
  const token = ensureCsrfToken(req, res);
  return send(res, status, injectCsrfFields(body, token));
}

function mimeType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".txt": "text/plain; charset=utf-8",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".svg": "image/svg+xml"
  }[extension] || "application/octet-stream";
}

async function serveStaticFromPrefix(req, res, urlPath, prefix, rootDir) {
  let relative = "";
  try {
    relative = decodeURIComponent(urlPath.slice(prefix.length)).replace(/^\/+/, "");
  } catch {
    return send(res, 400, "Bad request", "text/plain; charset=utf-8");
  }
  const root = path.resolve(rootDir);
  let target = path.resolve(root, relative || ".");
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    return send(res, 403, "Forbidden", "text/plain; charset=utf-8");
  }
  try {
    const stat = await fsp.stat(target);
    if (stat.isDirectory()) {
      target = path.join(target, "index.html");
    }
    const finalStat = await fsp.stat(target);
    if (!finalStat.isFile()) return send(res, 404, "Not found", "text/plain; charset=utf-8");
    const isAsset = !target.endsWith(".html");
    res.writeHead(200, {
      "Content-Type": mimeType(target),
      "Content-Length": finalStat.size,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": isAsset ? "private, max-age=86400" : "private, no-store"
    });
    if (req.method === "HEAD") return res.end();
    fs.createReadStream(target).pipe(res);
  } catch (error) {
    if (error.code === "ENOENT") return send(res, 404, "Not found", "text/plain; charset=utf-8");
    throw error;
  }
}

function redirectTo(res, location) {
  res.writeHead(303, { Location: location });
  res.end();
}

function csrfTokenFromBody(req, body) {
  const type = String(req.headers["content-type"] || "");
  if (/multipart\/form-data/i.test(type)) {
    try {
      return parseMultipart(body, type).find((part) => part.name === "_csrf")?.body.toString("utf8").trim() || "";
    } catch {
      return "";
    }
  }
  return new URLSearchParams(body.toString("utf8")).get("_csrf") || "";
}

function safeTokenEqual(a, b) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  return left.length > 0 && left.length === right.length && crypto.timingSafeEqual(left, right);
}

function bodyLimitForPath(pathname) {
  return pathname === `${BASE_PATH}/upload` || pathname === `${WORK_PATH}/upload-lab-image`
    ? MAX_UPLOAD_BYTES * 10 + 1024 * 1024
    : 1024 * 1024;
}

async function verifyCsrfRequest(req, res, url) {
  const body = await parseBody(req, bodyLimitForPath(url.pathname));
  const cookieToken = parseCookies(req).get(CSRF_COOKIE_NAME) || "";
  const bodyToken = csrfTokenFromBody(req, body);
  if (safeTokenEqual(cookieToken, bodyToken)) return true;
  return send(res, 403, "CSRF token invalid", "text/plain; charset=utf-8");
}

const loginAttempts = new Map();

function clientIp(req) {
  const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return forwarded || req.socket.remoteAddress || "unknown";
}

function loginAttemptKey(req, scope) {
  return `${scope}:${clientIp(req)}`;
}

function loginAttemptState(req, scope) {
  const key = loginAttemptKey(req, scope);
  const now = Date.now();
  const current = loginAttempts.get(key);
  if (!current || now - current.firstAt > LOGIN_ATTEMPT_WINDOW_MS) {
    const fresh = { count: 0, firstAt: now };
    loginAttempts.set(key, fresh);
    return { key, state: fresh };
  }
  return { key, state: current };
}

function tooManyLoginAttempts(req, scope) {
  return loginAttemptState(req, scope).state.count >= LOGIN_ATTEMPT_LIMIT;
}

function recordLoginFail(req, scope) {
  const { state } = loginAttemptState(req, scope);
  state.count += 1;
}

function clearLoginFail(req, scope) {
  loginAttempts.delete(loginAttemptKey(req, scope));
}

function authProfile(scope) {
  if (scope === "admin") {
    return {
      home: `${BASE_PATH}/`,
      login: `${BASE_PATH}/login`,
      logout: `${BASE_PATH}/logout`,
      cookie: "xx520_admin_session",
      prefixes: [BASE_PATH],
      title: "内容后台",
      subtitle: "改首页、写笔记、传照片，都从这里进入。",
      mark: "控",
      usernameField: true,
      usernameLabel: "账号",
      usernameValue: ADMIN_LOGIN_USER,
      passwordLabel: "密码",
      validate: (username, password) => username === ADMIN_LOGIN_USER && password === ADMIN_LOGIN_PASS
    };
  }
  if (scope === "work") {
    return {
      home: `${WORK_PATH}/`,
      login: `${WORK_PATH}/login`,
      logout: `${WORK_PATH}/logout`,
      cookie: "xx520_work_session",
      prefixes: [WORK_PATH],
      title: "工作区登录",
      subtitle: "登记试块、查看日历和提醒，需要先验证身份。",
      mark: "工",
      usernameField: true,
      usernameLabel: "账号",
      usernameValue: WORK_LOGIN_USER,
      passwordLabel: "密码",
      validate: (username, password) => username === WORK_LOGIN_USER && password === WORK_LOGIN_PASS
    };
  }
  return {
    home: `${PRIVATE_GALLERY_PATH}/`,
    login: `${PRIVATE_GALLERY_PATH}/login`,
    logout: `${PRIVATE_GALLERY_PATH}/logout`,
    cookie: "xx520_album_session",
    prefixes: [PRIVATE_GALLERY_PATH, PRIVATE_UPLOAD_PATH, PRIVATE_THUMB_PATH],
    title: "私密相册",
    subtitle: "输入相册密码后，可以查看照片、原图和下载入口。",
    mark: "相",
    usernameField: false,
    passwordLabel: "相册密码",
    validate: (_username, password) => password === PRIVATE_GALLERY_PASS
  };
}

function authLoginPath(scope) {
  return authProfile(scope).login;
}

function authLogoutPath(scope) {
  return authProfile(scope).logout;
}

function authCookieName(scope) {
  return authProfile(scope).cookie;
}

function loginOptions(scope, next, error = "") {
  const profile = authProfile(scope);
  return {
    title: profile.title,
    subtitle: profile.subtitle,
    mark: profile.mark,
    action: profile.login,
    next,
    error,
    usernameField: profile.usernameField,
    usernameLabel: profile.usernameLabel,
    usernameValue: profile.usernameValue,
    passwordLabel: profile.passwordLabel
  };
}

function ensureAuthed(req, res, url, scope) {
  if (validSession(req, authCookieName(scope), scope)) return true;
  const authProfileData = authProfile(scope);
  const authNext = safeNext(`${url.pathname}${url.search}`, authProfileData.home, authProfileData.prefixes);
  if (req.method === "GET" || req.method === "HEAD") {
    return send(res, 200, renderLoginPage(loginOptions(scope, authNext)));
  }
  redirectTo(res, `${authProfileData.login}?next=${encodeURIComponent(authNext)}`);
  return false;
}

async function handleCustomLogin(req, res, url, scope) {
  const loginProfile = authProfile(scope);
  const loginNextFromUrl = safeNext(url.searchParams.get("next"), loginProfile.home, loginProfile.prefixes);
  if (req.method === "GET" || req.method === "HEAD") {
    return send(res, 200, renderLoginPage(loginOptions(scope, loginNextFromUrl)));
  }
  if (req.method !== "POST") return send(res, 405, "Method not allowed", "text/plain; charset=utf-8");
  if (tooManyLoginAttempts(req, scope)) {
    return send(res, 429, renderLoginPage(loginOptions(scope, loginNextFromUrl, "Too many failed attempts. Try again in 10 minutes.")));
  }
  const loginParams = new URLSearchParams((await parseBody(req)).toString("utf8"));
  const loginNext = safeNext(loginParams.get("next"), loginNextFromUrl, loginProfile.prefixes);
  const loginUser = String(loginParams.get("username") || "").trim();
  const loginPass = String(loginParams.get("password") || "");
  if (!loginProfile.validate(loginUser, loginPass)) {
    recordLoginFail(req, scope);
    return send(res, 401, renderLoginPage(loginOptions(scope, loginNext, "账号或密码不对，再试一次。")));
  }
  clearLoginFail(req, scope);
  setLoginCookie(res, authCookieName(scope), scope);
  setCsrfCookie(res, csrfCookieValue());
  redirectTo(res, loginNext);
  return;
}

function handleCustomLogout(res, scope) {
  clearLoginCookie(res, authCookieName(scope));
  clearCsrfCookie(res);
  redirectTo(res, authLoginPath(scope));
}

function isPrivatePath(pathname) {
  return pathname === PRIVATE_GALLERY_PATH
    || pathname.startsWith(`${PRIVATE_GALLERY_PATH}/`)
    || pathname === PRIVATE_UPLOAD_PATH
    || pathname.startsWith(`${PRIVATE_UPLOAD_PATH}/`)
    || pathname === PRIVATE_THUMB_PATH
    || pathname.startsWith(`${PRIVATE_THUMB_PATH}/`);
}

async function handlePrivateGallery(req, res, url) {
  if (url.pathname === `${PRIVATE_GALLERY_PATH}/login`) return handleCustomLogin(req, res, url, "album");
  if (url.pathname === `${PRIVATE_GALLERY_PATH}/logout`) return handleCustomLogout(res, "album");
  if (!ensureAuthed(req, res, url, "album")) return;
  if (url.pathname === PRIVATE_UPLOAD_PATH || url.pathname.startsWith(`${PRIVATE_UPLOAD_PATH}/`)) {
    return serveStaticFromPrefix(req, res, url.pathname, PRIVATE_UPLOAD_PATH, PRIVATE_UPLOAD_DIR);
  }
  if (url.pathname === PRIVATE_THUMB_PATH || url.pathname.startsWith(`${PRIVATE_THUMB_PATH}/`)) {
    return serveStaticFromPrefix(req, res, url.pathname, PRIVATE_THUMB_PATH, PRIVATE_THUMB_DIR);
  }
  if (req.method !== "GET" && req.method !== "HEAD") {
    return send(res, 405, "Method not allowed", "text/plain; charset=utf-8");
  }

  const content = await readContent();
  const normalizedPath = url.pathname.replace(/\/+$/, "") || PRIVATE_GALLERY_PATH;
  if (normalizedPath === PRIVATE_GALLERY_PATH) {
    return send(res, 200, renderPrivateGalleryIndex(content));
  }

  const parts = normalizedPath.slice(`${PRIVATE_GALLERY_PATH}/`.length).split("/").filter(Boolean);
  const album = getAlbums(content, { private: true }).find((item) => item.slug === parts[0]);
  if (!album) return send(res, 404, "Not found", "text/plain; charset=utf-8");
  if (parts.length === 1) {
    return send(res, 200, renderAlbumPage(content, album, true));
  }
  if (parts.length === 2) {
    const photo = album.items.find((item) => imageSlug(item, item.index) === parts[1]);
    if (photo) return send(res, 200, renderPhotoPage(content, album, photo, true));
  }
  return send(res, 404, "Not found", "text/plain; charset=utf-8");
}

function smtpReady() {
  return Boolean(nodemailer && SMTP_CONFIG.host && SMTP_CONFIG.user && SMTP_CONFIG.pass && SMTP_CONFIG.to);
}

async function readReminderState() {
  try {
    return JSON.parse(await fsp.readFile(REMINDER_STATE_FILE, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return {};
  }
}

async function saveReminderState(state) {
  await writeAtomic(REMINDER_STATE_FILE, `${JSON.stringify(state, null, 2)}\n`);
}

function reminderSubject(referenceDate, items) {
  const demoldCount = items.filter((item) => item.type === "demold").length;
  const ageCount = items.filter((item) => item.type === "age").length;
  return `混凝土试块提醒 ${referenceDate}：拆模${demoldCount}项，龄期${ageCount}项`;
}

function reminderBody(content, referenceDate, items, forced = false) {
  if (!items.length) {
    return `今天是 ${referenceDate}。\n\n当前没有今日或逾期的拆模/龄期提醒。\n\n-- ${content.siteTitle}`;
  }
  const overdue = items.filter((item) => item.date < referenceDate);
  const todayItems = items.filter((item) => item.date === referenceDate);
  const lines = [
    `今天是 ${referenceDate}。`,
    "",
    forced ? "这是手动发送的提醒摘要。" : "以下是今日和逾期的试块提醒。",
    ""
  ];
  if (todayItems.length) {
    lines.push("今日事项：");
    todayItems.forEach((item) => lines.push(`- ${formatCalendarItem(item)}`));
    lines.push("");
  }
  if (overdue.length) {
    lines.push("逾期事项：");
    overdue.forEach((item) => lines.push(`- ${formatCalendarItem(item)}`));
    lines.push("");
  }
  lines.push(`-- ${content.siteTitle}`);
  return lines.join("\n");
}

function weatherCodeText(code) {
  const id = Number(code);
  if (id === 0) return "晴";
  if ([1, 2].includes(id)) return "少云";
  if (id === 3) return "阴";
  if ([45, 48].includes(id)) return "雾";
  if ([51, 53, 55, 56, 57].includes(id)) return "毛毛雨";
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(id)) return "雨";
  if ([71, 73, 75, 77, 85, 86].includes(id)) return "雪";
  if ([95, 96, 99].includes(id)) return "雷阵雨";
  return "天气";
}

function weatherValue(value, suffix = "") {
  const number = Number(value);
  if (!Number.isFinite(number)) return "未知";
  return `${Math.round(number * 10) / 10}${suffix}`;
}

async function fetchCampusWeather() {
  if (!WEATHER_CONFIG.enabled || !Number.isFinite(WEATHER_CONFIG.latitude) || !Number.isFinite(WEATHER_CONFIG.longitude)) {
    return { ok: false, error: "weather disabled", lines: [`${WEATHER_CONFIG.location}：天气未启用。`] };
  }
  const params = new URLSearchParams({
    latitude: String(WEATHER_CONFIG.latitude),
    longitude: String(WEATHER_CONFIG.longitude),
    current: "temperature_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m",
    daily: "temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum",
    timezone: WEATHER_CONFIG.timezone,
    forecast_days: "1"
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params.toString()}`, { signal: controller.signal });
    if (!response.ok) throw new Error(`weather http ${response.status}`);
    const data = await response.json();
    const current = data.current || {};
    const daily = data.daily || {};
    const summary = `${weatherCodeText(current.weather_code)} ${weatherValue(current.temperature_2m, "℃")}`;
    return {
      ok: true,
      summary,
      lines: [
        `${WEATHER_CONFIG.location}：${summary}`,
        `体感 ${weatherValue(current.apparent_temperature, "℃")}，风速 ${weatherValue(current.wind_speed_10m, "km/h")}`,
        `今日 ${weatherValue((daily.temperature_2m_min || [])[0], "℃")} - ${weatherValue((daily.temperature_2m_max || [])[0], "℃")}，降水概率 ${weatherValue((daily.precipitation_probability_max || [])[0], "%")}，降水量 ${weatherValue((daily.precipitation_sum || [])[0], "mm")}`
      ]
    };
  } catch (error) {
    return { ok: false, error: error.message || "weather failed", lines: [`${WEATHER_CONFIG.location}：天气暂时获取失败，稍后可再看。`] };
  } finally {
    clearTimeout(timeout);
  }
}

function reminderSubjectV2(referenceDate, items, weather) {
  const demoldCount = items.filter((item) => item.type === "demold").length;
  const ageCount = items.filter((item) => item.type === "age").length;
  const weatherText = weather && weather.ok ? `，${weather.summary}` : "";
  return `工作区提醒 ${referenceDate}：拆模${demoldCount}项，龄期${ageCount}项${weatherText}`;
}

function reminderBodyV2(content, referenceDate, items, forced = false, weather = null) {
  const overdue = items.filter((item) => item.date < referenceDate);
  const todayItems = items.filter((item) => item.date === referenceDate);
  const lines = [
    `今天是 ${referenceDate}。`,
    "",
    "虎峪校区天气：",
    ...(weather && Array.isArray(weather.lines) ? weather.lines.map((line) => `- ${line}`) : [`- ${WEATHER_CONFIG.location}：天气暂时获取失败。`]),
    "",
    forced ? "这是手动发送的提醒摘要。" : "以下是今日和逾期的试块提醒。",
    ""
  ];
  if (!items.length) {
    lines.push("当前没有今日或逾期的拆模/龄期提醒。", "");
  }
  if (todayItems.length) {
    lines.push("今日事项：");
    todayItems.forEach((item) => lines.push(`- ${formatCalendarItem(item)}`));
    lines.push("");
  }
  if (overdue.length) {
    lines.push("逾期事项：");
    overdue.forEach((item) => lines.push(`- ${formatCalendarItem(item)}`));
    lines.push("");
  }
  lines.push(`-- ${content.siteTitle}`);
  return lines.join("\n");
}

async function sendReminderEmail(content, options = {}) {
  if (!smtpReady()) {
    throw Object.assign(new Error("SMTP not configured"), { statusCode: 500 });
  }
  const referenceDate = options.referenceDate || today();
  const items = options.items || activeMailItems(content, referenceDate);
  const weather = options.weather || await fetchCampusWeather();
  const transporter = nodemailer.createTransport({
    host: SMTP_CONFIG.host,
    port: SMTP_CONFIG.port,
    secure: SMTP_CONFIG.secure,
    auth: {
      user: SMTP_CONFIG.user,
      pass: SMTP_CONFIG.pass
    }
  });
  await transporter.sendMail({
    from: `"xx520 工作区" <${SMTP_CONFIG.user}>`,
    to: SMTP_CONFIG.to,
    subject: reminderSubjectV2(referenceDate, items, weather),
    text: reminderBodyV2(content, referenceDate, items, options.force === true, weather)
  });
  return items.length;
}

let reminderSending = false;

async function checkDailyReminder() {
  if (!smtpReady()) return;
  if (reminderSending) return;
  reminderSending = true;
  try {
    const parts = beijingParts();
    const referenceDate = `${parts.year}-${parts.month}-${parts.day}`;
    if (parts.hour < REMINDER_HOUR) return;
    const state = await readReminderState();
    if (state.lastDailyDate === referenceDate) return;
    const content = await readContent();
    const items = activeMailItems(content, referenceDate);
    try {
      await sendReminderEmail(content, { referenceDate, items });
      state.lastResult = `sent-${items.length}`;
      state.lastSentAt = new Date().toISOString();
    } catch (error) {
      state.lastDailyDate = referenceDate;
      state.lastResult = `error-${error.responseCode || error.code || "send"}`;
      state.lastErrorAt = new Date().toISOString();
      await saveReminderState(state);
      throw error;
    }
    state.lastDailyDate = referenceDate;
    await saveReminderState(state);
  } finally {
    reminderSending = false;
  }
}

async function handleUpload(req, res) {
  const wantsJson = /application\/json/i.test(req.headers.accept || "") || req.headers["x-requested-with"] === "XMLHttpRequest";
  const body = await parseBody(req, MAX_UPLOAD_BYTES * 10 + 1024 * 1024);
  const parts = parseMultipart(body, req.headers["content-type"]);
  const getText = (name) => parts.find((part) => part.name === name)?.body.toString("utf8").trim() || "";
  const images = parts.filter((part) => part.name === "image" && part.filename && part.body.length);
  if (!images.length) throw Object.assign(new Error("missing image"), { statusCode: 400 });
  if (images.some((image) => image.body.length > MAX_UPLOAD_BYTES)) {
    throw Object.assign(new Error("image too large"), { statusCode: 413 });
  }
  if (images.some((image) => !allowedTypes.has(image.type))) {
    throw Object.assign(new Error("unsupported image type"), { statusCode: 400 });
  }

  await ensureDirs();
  const content = await readContent();
  const title = getText("imageTitle");
  const caption = getText("imageCaption");
  const album = getText("albumName") || DEFAULT_ALBUM;
  const isPrivate = ["1", "on", "true", "yes"].includes(getText("privateAlbum").toLowerCase());
  const targetDir = isPrivate ? PRIVATE_UPLOAD_DIR : UPLOAD_DIR;
  const publicPath = isPrivate ? PRIVATE_UPLOAD_PATH : PUBLIC_UPLOAD_PATH;
  const uploaded = [];

  for (let i = 0; i < images.length; i += 1) {
    const image = images[i];
    const extension = allowedTypes.get(image.type);
    const safeBase = path.basename(image.filename, path.extname(image.filename)).replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 42) || "image";
    const imageTitle = title || path.basename(image.filename, path.extname(image.filename)) || "相册图片";
    const filename = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}-${safeBase}${extension}`;
    await writeAtomic(path.join(targetDir, filename), image.body);
    uploaded.push({
      src: `${publicPath}/${filename}`,
      title: images.length === 1 ? imageTitle : `${imageTitle} ${i + 1}`,
      caption,
      album,
      private: isPrivate
    });
  }

  content.gallery = [...uploaded, ...content.gallery];
  await saveContent(content);
  if (wantsJson) {
    return send(res, 200, JSON.stringify({ ok: true, count: uploaded.length, photos: uploaded }), "application/json; charset=utf-8");
  }
  redirect(res, `${uploaded.length} 张图片已上传并发布`);
}

async function handleUploadLabImage(req, res, redirectBase = WORK_PATH) {
  const wantsJson = /application\/json/i.test(req.headers.accept || "") || req.headers["x-requested-with"] === "XMLHttpRequest";
  const body = await parseBody(req, MAX_UPLOAD_BYTES * 12 + 1024 * 1024);
  const parts = parseMultipart(body, req.headers["content-type"]);
  const getText = (name) => parts.find((part) => part.name === name)?.body.toString("utf8").trim() || "";
  const targetType = String(getText("targetType") || "").trim();
  const targetId = String(getText("targetId") || "").trim();
  const rawKind = normalizeLabImageKind(getText("imageKind"));
  const allowedKindIds = new Set((targetType === "gangue" ? GANGUE_LAB_IMAGE_KIND_IDS : BLOCK_LAB_IMAGE_KIND_IDS));
  const kind = allowedKindIds.has(rawKind) ? rawKind : (targetType === "gangue" ? "gangueRaw" : "forming");
  const title = getText("imageTitle");
  const caption = getText("imageCaption");
  const images = parts.filter((part) => part.name === "image" && part.filename && part.body.length);
  if (!["gangue", "block"].includes(targetType) || !targetId) {
    throw Object.assign(new Error("missing image target"), { statusCode: 400 });
  }
  if (!images.length) throw Object.assign(new Error("missing image"), { statusCode: 400 });
  if (images.some((image) => image.body.length > MAX_UPLOAD_BYTES)) {
    throw Object.assign(new Error("image too large"), { statusCode: 413 });
  }
  if (images.some((image) => !allowedTypes.has(image.type))) {
    throw Object.assign(new Error("unsupported image type"), { statusCode: 400 });
  }

  await ensureDirs();
  const uploaded = [];
  for (let i = 0; i < images.length; i += 1) {
    const image = images[i];
    const extension = allowedTypes.get(image.type);
    const safeBase = path.basename(image.filename, path.extname(image.filename)).replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 42) || "lab-image";
    const filename = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}-${safeBase}${extension}`;
    await writeAtomic(path.join(WORK_UPLOAD_DIR, filename), image.body);
    const baseTitle = title || path.basename(image.filename, path.extname(image.filename)) || labImageKindLabel(kind);
    uploaded.push({
      src: `${WORK_FILE_PATH}/${filename}`,
      title: images.length === 1 ? baseTitle : `${baseTitle} ${i + 1}`,
      caption,
      kind,
      createdAt: new Date().toISOString()
    });
  }

  const content = await readContent();
  let found = false;
  if (targetType === "gangue") {
    content.coalGangueDb = getCoalGangueDb(content).map((item) => {
      if (item.id !== targetId) return item;
      found = true;
      return normalizeCoalGangueItem({ ...item, images: [...uploaded, ...normalizeLabImages(item.images)] });
    });
  } else {
    content.testBlocks = getTestBlocks(content).map((block) => {
      if (block.id !== targetId) return block;
      found = true;
      return { ...block, images: [...uploaded, ...normalizeLabImages(block.images)] };
    });
  }
  if (!found) throw Object.assign(new Error("image target not found"), { statusCode: 404 });
  await saveContent(content);
  if (wantsJson) {
    return send(res, 200, JSON.stringify({ ok: true, count: uploaded.length, photos: uploaded }), "application/json; charset=utf-8");
  }
  if (targetType === "block") {
    return redirectTo(res, `${redirectBase}/?msg=${encodeURIComponent(`${uploaded.length} 张实验图片已上传`)}&openBlock=${encodeURIComponent(targetId)}&tab=images#record-${encodeURIComponent(targetId)}`);
  }
  redirect(res, `${uploaded.length} 张实验图片已上传`, redirectBase, `gangue-${targetId}`);
}

async function handleDeleteLabImage(req, res, redirectBase = WORK_PATH) {
  const params = new URLSearchParams((await parseBody(req)).toString("utf8"));
  const targetType = String(params.get("targetType") || "").trim();
  const targetId = String(params.get("targetId") || "").trim();
  const src = String(params.get("src") || "").trim();
  if (!["gangue", "block"].includes(targetType) || !targetId || !src) {
    throw Object.assign(new Error("missing image delete target"), { statusCode: 400 });
  }
  const content = await readContent();
  let removed = false;
  if (targetType === "gangue") {
    content.coalGangueDb = getCoalGangueDb(content).map((item) => {
      if (item.id !== targetId) return item;
      removed = normalizeLabImages(item.images).some((image) => image.src === src);
      return normalizeCoalGangueItem({ ...item, images: normalizeLabImages(item.images).filter((image) => image.src !== src) });
    });
  } else {
    content.testBlocks = getTestBlocks(content).map((block) => {
      if (block.id !== targetId) return block;
      removed = normalizeLabImages(block.images).some((image) => image.src === src);
      return { ...block, images: normalizeLabImages(block.images).filter((image) => image.src !== src) };
    });
  }
  if (removed && src.startsWith(`${WORK_FILE_PATH}/`)) {
    await fsp.rm(path.join(WORK_UPLOAD_DIR, path.basename(src)), { force: true });
  }
  await saveContent(content);
  if (targetType === "block") {
    return redirectTo(res, `${redirectBase}/?msg=${encodeURIComponent(removed ? "实验图片已删除" : "没有找到这张实验图片")}&openBlock=${encodeURIComponent(targetId)}&tab=images#record-${encodeURIComponent(targetId)}`);
  }
  redirect(res, removed ? "实验图片已删除" : "没有找到这张实验图片", redirectBase, targetType === "gangue" ? `gangue-${targetId}` : `block-${targetId}`);
}

async function handleDeleteImage(req, res) {
  const params = new URLSearchParams((await parseBody(req)).toString("utf8"));
  const src = String(params.get("src") || "");
  const content = await readContent();
  const removed = content.gallery.filter((item) => item.src === src);
  content.gallery = content.gallery.filter((item) => item.src !== src);
  if (src.startsWith(`${PUBLIC_UPLOAD_PATH}/`)) {
    await fsp.rm(path.join(UPLOAD_DIR, path.basename(src)), { force: true });
  }
  if (src.startsWith(`${PRIVATE_UPLOAD_PATH}/`)) {
    await fsp.rm(path.join(PRIVATE_UPLOAD_DIR, path.basename(src)), { force: true });
  }
  for (const item of removed) {
    const info = thumbnailInfo(item.src);
    if (info) await fsp.rm(info.thumbPath, { force: true });
  }
  await saveContent(content);
  redirect(res, "图片已删除");
}

async function handleRenameAlbum(req, res) {
  const params = new URLSearchParams((await parseBody(req)).toString("utf8"));
  const oldAlbum = String(params.get("oldAlbum") || "").trim();
  const newAlbum = String(params.get("newAlbum") || "").trim();
  const isPrivate = String(params.get("privateAlbum") || "") === "1";
  if (!oldAlbum || !newAlbum) throw Object.assign(new Error("missing album name"), { statusCode: 400 });
  const content = await readContent();
  content.gallery = content.gallery.map((item) => (
    item.album === oldAlbum && Boolean(item.private) === isPrivate
      ? { ...item, album: newAlbum }
      : item
  ));
  await saveContent(content);
  redirect(res, "相册名称已保存");
}

const CRC32_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { dosTime, dosDate };
}

function createZip(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const { dosTime, dosDate } = dosDateTime();
  files.forEach((file) => {
    const name = Buffer.from(file.name, "utf8");
    const data = Buffer.isBuffer(file.data) ? file.data : Buffer.from(String(file.data), "utf8");
    const checksum = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(dosTime, 12);
    central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + data.length;
  });
  const centralOffset = offset;
  const centralSize = centralParts.reduce((total, part) => total + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(centralOffset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, ...centralParts, end]);
}

function xml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function columnName(index) {
  let number = index + 1;
  let name = "";
  while (number > 0) {
    const remainder = (number - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    number = Math.floor((number - 1) / 26);
  }
  return name;
}

function xlsxCell(value, rowIndex, columnIndex, style = 0) {
  if (value === undefined || value === null || value === "") return "";
  const ref = `${columnName(columnIndex)}${rowIndex}`;
  const styleAttr = style ? ` s="${style}"` : "";
  if (typeof value === "number" && Number.isFinite(value)) {
    return `<c r="${ref}"${styleAttr}><v>${value}</v></c>`;
  }
  return `<c r="${ref}" t="inlineStr"${styleAttr}><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
}

function xlsxSheet(rows, widths = []) {
  const cols = widths.length
    ? `<cols>${widths.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join("")}</cols>`
    : "";
  const sheetRows = rows.map((row, rowIndex) => {
    const excelRow = rowIndex + 1;
    const style = rowIndex === 0 ? 1 : 0;
    const cells = row.map((value, columnIndex) => xlsxCell(value, excelRow, columnIndex, style)).join("");
    return `<row r="${excelRow}">${cells}</row>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
  ${cols}
  <sheetData>${sheetRows}</sheetData>
</worksheet>`;
}

function xlsxStyles() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="2"><font><sz val="11"/><name val="Microsoft YaHei"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Microsoft YaHei"/></font></fonts>
  <fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1F5F4A"/><bgColor indexed="64"/></patternFill></fill></fills>
  <borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
}

function workbookXml(sheetNames) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <workbookPr date1904="false"/>
  <sheets>${sheetNames.map((name, index) => `<sheet name="${xml(name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join("")}</sheets>
</workbook>`;
}

function workbookRels(sheetNames) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${sheetNames.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join("")}
  <Relationship Id="rId${sheetNames.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;
}

function contentTypes(sheetNames) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  ${sheetNames.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`;
}

function rootRels() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`;
}

function docProps(sheetCount) {
  const now = new Date().toISOString();
  return {
    core: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>混凝土试块导出</dc:title><dc:creator>xx520 工作区</dc:creator><cp:lastModifiedBy>xx520 工作区</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified>
</cp:coreProperties>`,
    app: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>xx520 工作区</Application><DocSecurity>0</DocSecurity><ScaleCrop>false</ScaleCrop><HeadingPairs><vt:vector size="2" baseType="variant"><vt:variant><vt:lpstr>Worksheets</vt:lpstr></vt:variant><vt:variant><vt:i4>${sheetCount}</vt:i4></vt:variant></vt:vector></HeadingPairs>
</Properties>`
  };
}

function makeWorkbook(sheets) {
  const sheetNames = sheets.map((sheet) => sheet.name.slice(0, 31));
  const props = docProps(sheetNames.length);
  return createZip([
    { name: "[Content_Types].xml", data: contentTypes(sheetNames) },
    { name: "_rels/.rels", data: rootRels() },
    { name: "docProps/core.xml", data: props.core },
    { name: "docProps/app.xml", data: props.app },
    { name: "xl/workbook.xml", data: workbookXml(sheetNames) },
    { name: "xl/_rels/workbook.xml.rels", data: workbookRels(sheetNames) },
    { name: "xl/styles.xml", data: xlsxStyles() },
    ...sheets.map((sheet, index) => ({ name: `xl/worksheets/sheet${index + 1}.xml`, data: xlsxSheet(sheet.rows, sheet.widths) }))
  ]);
}

function ratioText(value, digits = 3) {
  return value ? formatRecipeNumber(value, digits) : "";
}

function percentText(value) {
  return value ? `${formatRecipeNumber(value * 100, 2)}%` : "";
}

function exportCode(index) {
  return `S${String(index + 1).padStart(3, "0")}`;
}

function createBlocksExportWorkbook(content, blocks) {
  const normalized = blocks.map((block, index) => {
    const metrics = normalizeResultMetrics(block.metrics || (block.record && block.record.metrics));
    const recipeMaterials = normalizeRecipeMaterials(block.recipeMaterials || (block.record && block.record.recipeMaterials));
    const record = normalizeBlockRecord(block.record, block.ages, metrics, recipeMaterials);
    return { block, record, metrics, recipeMaterials, code: exportCode(index) };
  });
  const relatedGangueIds = new Set(normalized.map((item) => item.record.gangueAggregateId).filter(Boolean));
  const relatedGangues = getCoalGangueDb(content).filter((item) => relatedGangueIds.has(item.id));

  const gangueRows = [[
    "煤矸石ID", "煤矸石编号/名称", "来源/批次", "采样日期", "粒径范围", "本批压碎值", "本批压碎值粒径",
    "各粒径压碎值明细", "压碎值第1次", "压碎值第2次", "压碎值第3次", "压碎值平均值",
    "粗骨料吸水率", "细骨料吸水率", "粗骨料表观密度", "细骨料表观密度", "松散/压紧堆积密度",
    "针片状含量", "石粉/MB/其他信息", "备注"
  ]];
  relatedGangues.forEach((item) => {
    const gradationDensity = item.gradations.map((row) => `${row.name || "级配"}：松散${row.looseBulkDensity || "-"}，压紧${row.compactedBulkDensity || "-"}`).join("；");
    const flakiness = Object.entries(item.flakinessValues || {}).filter(([, value]) => value).map(([range, value]) => `${range}:${value}`).join("；");
    const crushingSummary = calculateGangueCrushingSummary(item);
    const ranges = item.particleRanges && item.particleRanges.length ? item.particleRanges : defaultParticleRanges();
    const crushingRows = ranges.map((range) => {
      const tests = item.crushingTests?.[range] || [];
      const averageText = formatMeasurementAverage(tests) || item.crushingValues?.[range] || "";
      const mark = crushingSummary.range === range && averageText ? "（本批最大）" : "";
      return {
        range,
        tests: [tests[0] || "", tests[1] || "", tests[2] || ""],
        averageText,
        text: `${range}: ${[tests[0] || "-", tests[1] || "-", tests[2] || "-"].join(" / ")} -> ${averageText || "-"}${mark}`
      };
    });
    gangueRows.push([
      item.id, item.name, item.source, item.updatedAt || "", ranges.join("，"), crushingSummary.text || item.batchCrushingValue, crushingSummary.range || item.batchCrushingRange,
      crushingRows.map((row) => row.text).join("；"),
      crushingRows.map((row) => `${row.range}:${row.tests[0] || "-"}`).join("；"),
      crushingRows.map((row) => `${row.range}:${row.tests[1] || "-"}`).join("；"),
      crushingRows.map((row) => `${row.range}:${row.tests[2] || "-"}`).join("；"),
      crushingRows.map((row) => `${row.range}:${row.averageText || "-"}`).join("；"),
      item.coarseWaterAbsorption, item.fineWaterAbsorption, item.coarseApparentDensity, item.fineApparentDensity,
      gradationDensity, flakiness, item.otherInfo, ""
    ]);
  });

  const gradationRows = [["级配ID", "煤矸石ID", "试块组ID", "粒径范围", "方案/模型", "n值", "目标总量g", "各粒径克数", "备注"]];
  normalized.forEach(({ block, record }) => {
    const scheme = gradationSchemeForCategory(block.blockCategory);
    const template = scheme.templates[normalizeGradationTemplate(record.gradationTemplate)] || scheme.templates.raw;
    const weights = normalizeBlockGradationWeights(record.gradationWeights, block.blockCategory, record.gradationTemplate);
    const weightText = Object.entries(weights).filter(([, value]) => value).map(([range, value]) => `${range}:${value}`).join("；");
    const total = Object.values(weights).map(parseRecipeWeight).reduce((sum, value) => sum + value, 0);
    gradationRows.push([
      `${block.id}-gradation`, record.gangueAggregateId, block.id, scheme.ranges.join("，"), template.label, template.nValue || record.gradationCoefficient,
      total ? formatRecipeNumber(total, 2) : "", weightText, record.recipeNote
    ]);
  });

  const mixRows = [[
    "配合比ID", "试块组ID", "配合比名称", "胶凝材料合计g", "煤矸石/骨料合计g", "水g", "水胶比", "骨灰比",
    "硅酸盐水泥g", "粉煤灰g", "生石灰g", "煤矸石g", "硫酸钠g", "速凝剂g", "称量模板", "备注"
  ]];
  normalized.forEach(({ block, record, recipeMaterials }) => {
    const ratios = calculateRecipeRatios(record);
    const values = normalizeRecipeValues(record.recipeValues, recipeMaterials, record);
    const valueFor = (label) => {
      const id = materialIdForTemplateLabel(recipeMaterials, label);
      return id ? values[id] || "" : "";
    };
    mixRows.push([
      `${block.id}-mix`, block.id, record.mixName, ratios.binderTotal || "", ratios.aggregateTotal || "", ratios.waterTotal || "",
      ratioText(ratios.waterBinderRatio), ratioText(ratios.aggregateBinderRatio),
      valueFor("硅酸盐水泥"), valueFor("粉煤灰"), valueFor("生石灰"), valueFor("煤矸石"), valueFor("硫酸钠"), valueFor("速凝剂"),
      WEIGHING_TEMPLATES[normalizeWeighingTemplate(record.weighingTemplate, block.blockCategory)]?.label || "", record.recipeNote
    ]);
  });

  const blockRows = [[
    "试块组ID", "试块组名称", "煤矸石ID", "煤矸石名称", "试块类型", "数量", "强度等级", "成型日期",
    "3d日期", "7d日期", "28d日期", "全部龄期", "级配模板", "配合比模板", "状态", "备注"
  ]];
  normalized.forEach(({ block, record }) => {
    const resultItems = blockResultDueItemsV22([block]);
    const filled = resultItems.filter((item) => item.filled).length;
    const status = filled >= resultItems.length && resultItems.length ? "全部完成" : filled ? `已录 ${filled}/${resultItems.length}` : "未录结果";
    blockRows.push([
      block.id, block.name, record.gangueAggregateId, record.gangueAggregateName, blockCategoryLabelV3(block.blockCategory), block.quantity, block.strength, block.madeDate,
      block.ages.includes(3) ? addDays(block.madeDate, 3) : "", block.ages.includes(7) ? addDays(block.madeDate, 7) : "", block.ages.includes(28) ? addDays(block.madeDate, 28) : "",
      block.ages.join("，"), gradationSchemeForCategory(block.blockCategory).templates[normalizeGradationTemplate(record.gradationTemplate)]?.label || "",
      WEIGHING_TEMPLATES[normalizeWeighingTemplate(record.weighingTemplate, block.blockCategory)]?.label || "", status, block.note
    ]);
  });

  const resultRows = [["试块组ID", "煤矸石ID", "试块组名称", "龄期", "指标", "到期日期", "试验日期", "样本值MPa", "试件明细(kN/mm2/MPa)", "均值", "均值来源", "标准差", "CV%", "破坏形态", "备注"]];
  normalized.forEach(({ block, record, metrics }) => {
    const results = normalizeAgeResults(record, block.ages, metrics);
    block.ages.forEach((age) => {
      const row = results[String(age)] || {};
      metrics.forEach((metric) => {
        const entry = normalizeMetricResultEntry((row.metricResults || {})[metric.id], (row.metrics || {})[metric.id], {
          age,
          metric: metric.id,
          dueDate: addDays(block.madeDate, age)
        });
        const specimenText = (entry.sampleMeasurements || []).map((sample, index) => {
          const parts = [
            `试件${index + 1}`,
            sample.pressureKn ? `压力${sample.pressureKn}kN` : "",
            sample.areaMm2 ? `面积${sample.areaMm2}mm2` : "",
            sample.strengthMpa ? `强度${sample.strengthMpa}MPa` : "",
            sample.failureMode ? `破坏${sample.failureMode}` : "",
            sample.remark ? `备注${sample.remark}` : ""
          ].filter(Boolean);
          return parts.join("/");
        }).join("；");
        resultRows.push([
          block.id, record.gangueAggregateId, block.name, age, metric.label, addDays(block.madeDate, age), row.testDate || "",
          entry.sampleValues.join(", "), specimenText, entry.mean, entry.meanSource, entry.std, entry.cv, entry.failureMode, entry.remark || row.resultNote || ""
        ]);
      });
    });
  });

  return makeWorkbook([
    { name: "煤矸石档案", rows: gangueRows, widths: [22, 24, 22, 12, 34, 12, 16, 82, 42, 42, 42, 42, 14, 14, 16, 16, 36, 32, 36, 20] },
    { name: "级配方案", rows: gradationRows, widths: [24, 22, 22, 38, 18, 10, 12, 70, 28] },
    { name: "配合比方案", rows: mixRows, widths: [22, 22, 22, 14, 16, 10, 10, 10, 12, 12, 12, 12, 12, 12, 16, 32] },
    { name: "试块记录", rows: blockRows, widths: [22, 26, 22, 22, 12, 8, 10, 12, 12, 12, 12, 16, 16, 16, 14, 34] },
    { name: "强度结果", rows: resultRows, widths: [22, 22, 26, 10, 18, 12, 12, 24, 48, 12, 12, 12, 10, 18, 34] }
  ]);
}

function sendDownload(res, filename, buffer) {
  res.writeHead(200, {
    "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "Content-Length": buffer.length,
    "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "private, no-store"
  });
  res.end(buffer);
}

async function handleExportBlocks(req, res, redirectBase = WORK_PATH) {
  const params = new URLSearchParams((await parseBody(req)).toString("utf8"));
  const exportAll = params.get("exportAll") === "1";
  const ids = params.getAll("blockIds").map((id) => String(id || "").trim()).filter(Boolean);
  if (!exportAll && !ids.length) return redirect(res, "请先勾选要导出的试块", redirectBase);
  const idSet = new Set(ids);
  const content = await readContent();
  const blocks = exportAll ? getTestBlocks(content) : getTestBlocks(content).filter((block) => idSet.has(block.id));
  if (!blocks.length) return redirect(res, "没有找到要导出的试块", redirectBase);
  const workbook = createBlocksExportWorkbook(content, blocks);
  sendDownload(res, `${exportAll ? "全部试块导出" : "试块导出"}-${today()}.xlsx`, workbook);
}

function coalGangueFromParams(params, existing = {}) {
  const ranges = splitParticleRanges(params.get("particleRanges")).length
    ? splitParticleRanges(params.get("particleRanges"))
    : (existing.particleRanges && existing.particleRanges.length ? existing.particleRanges : defaultParticleRanges());
  const rangeLabels = params.getAll("rangeLabel");
  const crushingInput1 = params.getAll("crushingValue1");
  const crushingInput2 = params.getAll("crushingValue2");
  const crushingInput3 = params.getAll("crushingValue3");
  const legacyCrushingInputs = params.getAll("crushingValue");
  const flakinessRangeLabels = params.getAll("flakinessRangeLabel");
  const flakinessInputs = params.getAll("flakinessValue");
  const existingCrushing = existing.crushingValues && typeof existing.crushingValues === "object" ? existing.crushingValues : {};
  const existingCrushingTests = existing.crushingTests && typeof existing.crushingTests === "object" ? existing.crushingTests : {};
  const existingFlaky = existing.flakinessValues && typeof existing.flakinessValues === "object" ? existing.flakinessValues : {};
  const crushingValues = {};
  const crushingTests = {};
  const flakinessValues = {};
  ranges.forEach((range, index) => {
    const previousIndex = rangeLabels.findIndex((label) => label === range);
    const inputIndex = previousIndex >= 0 ? previousIndex : index;
    const existingTests = Array.isArray(existingCrushingTests[range]) ? existingCrushingTests[range] : [];
    const legacyValue = legacyCrushingInputs[inputIndex] ?? existingCrushing[range] ?? "";
    const tests = [
      String(crushingInput1[inputIndex] ?? existingTests[0] ?? legacyValue ?? "").trim(),
      String(crushingInput2[inputIndex] ?? existingTests[1] ?? "").trim(),
      String(crushingInput3[inputIndex] ?? existingTests[2] ?? "").trim()
    ];
    crushingTests[range] = tests;
    crushingValues[range] = formatMeasurementAverage(tests);
    const flakyIndex = flakinessRangeLabels.findIndex((label) => label === range);
    const flakinessIndex = flakyIndex >= 0 ? flakyIndex : index;
    flakinessValues[range] = String(flakinessInputs[flakinessIndex] ?? existingFlaky[range] ?? "").trim();
  });
  const names = params.getAll("gradationName");
  const nValues = params.getAll("gradationNValue");
  const loose = params.getAll("looseBulkDensity");
  const compacted = params.getAll("compactedBulkDensity");
  const notes = params.getAll("gradationNote");
  const gradations = names.map((name, index) => {
    const gradationRangeLabels = params.getAll(`gradationRange_${index}`);
    const gradationWeights = params.getAll(`gradationWeight_${index}`);
    const particleWeights = {};
    ranges.forEach((range, rangeIndex) => {
      const previousIndex = gradationRangeLabels.findIndex((label) => label === range);
      const inputIndex = previousIndex >= 0 ? previousIndex : rangeIndex;
      particleWeights[range] = String(gradationWeights[inputIndex] || "").trim();
    });
    return {
      name: String(name || "").trim(),
      nValue: String(nValues[index] || "").trim(),
      looseBulkDensity: String(loose[index] || "").trim(),
      compactedBulkDensity: String(compacted[index] || "").trim(),
      particleWeights,
      note: String(notes[index] || "").trim()
    };
  }).filter((item) => (
    item.name || item.nValue || item.looseBulkDensity || item.compactedBulkDensity || item.note
    || Object.values(item.particleWeights).some(Boolean)
  ));
  return normalizeCoalGangueItem({
    ...existing,
    name: params.get("gangueName"),
    source: params.get("source"),
    particleRanges: ranges,
    crushingValues,
    crushingTests,
    flakinessValues,
    coarseWaterAbsorption: params.get("coarseWaterAbsorption"),
    fineWaterAbsorption: params.get("fineWaterAbsorption"),
    coarseApparentDensity: params.get("coarseApparentDensity"),
    fineApparentDensity: params.get("fineApparentDensity"),
    gradations,
    otherInfo: params.get("otherInfo"),
    updatedAt: today()
  });
}

async function handleAddGangue(req, res, redirectBase = WORK_PATH) {
  const params = new URLSearchParams((await parseBody(req)).toString("utf8"));
  const name = String(params.get("gangueName") || "").trim();
  if (!name) throw Object.assign(new Error("missing gangue name"), { statusCode: 400 });
  const content = await readContent();
  const item = coalGangueFromParams(params, { id: crypto.randomUUID() });
  content.coalGangueDb = [item, ...getCoalGangueDb(content)];
  await saveContent(content);
  redirect(res, "煤矸石数据已新增", redirectBase, `gangue-${item.id}`);
}

async function handleUpdateGangue(req, res, redirectBase = WORK_PATH) {
  const params = new URLSearchParams((await parseBody(req)).toString("utf8"));
  const id = String(params.get("id") || "").trim();
  if (!id) throw Object.assign(new Error("missing gangue id"), { statusCode: 400 });
  const content = await readContent();
  let found = false;
  content.coalGangueDb = getCoalGangueDb(content).map((item) => {
    if (item.id !== id) return item;
    found = true;
    return coalGangueFromParams(params, item);
  });
  if (!found) throw Object.assign(new Error("gangue not found"), { statusCode: 404 });
  await saveContent(content);
  redirect(res, "煤矸石数据已保存", redirectBase, `gangue-${id}`);
}

async function handleDeleteGangue(req, res, redirectBase = WORK_PATH) {
  const params = new URLSearchParams((await parseBody(req)).toString("utf8"));
  const id = String(params.get("id") || "").trim();
  const content = await readContent();
  content.coalGangueDb = getCoalGangueDb(content).filter((item) => item.id !== id);
  await saveContent(content);
  redirect(res, "煤矸石数据已删除", redirectBase);
}

async function handleAddBlock(req, res, redirectBase = BASE_PATH) {
  const params = new URLSearchParams((await parseBody(req)).toString("utf8"));
  const name = String(params.get("blockName") || "").trim();
  if (!name) throw Object.assign(new Error("missing block name"), { statusCode: 400 });
  const ages = normalizeAges(params.get("ages"));
  const madeDate = normalizeDateValue(params.get("madeDate"));
  const content = await readContent();
  updateRecipeMaterialLibraryFromParams(content, params);
  const selectedGangueId = String(params.get("gangueAggregateId") || "").trim();
  const selectedGangueName = selectedGangueId ? coalGangueNameById(content, selectedGangueId) : "";
  const blockCategory = normalizeBlockCategory(params.get("blockCategory"), "road");
  const weighingTemplate = normalizeWeighingTemplate(params.get("weighingTemplate"), blockCategory);
  const gradationTemplate = normalizeGradationTemplate(params.get("gradationTemplate"));
  const blockAges = ages.length ? ages : [3, 7, 28];
  const blockMetrics = metricsFromParams(params);
  const blockRecipeMaterials = templateRecipeMaterials(weighingTemplate, recipeMaterialsFromParams(params, content));
  const recipeValues = applyWeighingTemplateToRecipeValues({}, blockRecipeMaterials, weighingTemplate);
  const gradationWeights = blockGradationWeightsFromParams(params, blockCategory, gradationTemplate);
  const gradationCoefficient = gradationCoefficientForTemplate(blockCategory, gradationTemplate) || String(params.get("gradationCoefficient") || "").trim();
  const blockId = crypto.randomUUID();
  content.testBlocks = [{
    id: blockId,
    name,
    blockCategory,
    madeDate,
    quantity: Math.max(1, Number.parseInt(params.get("quantity"), 10) || 1),
    ages: blockAges,
    metrics: blockMetrics,
    recipeMaterials: blockRecipeMaterials,
    demoldDate: addDays(madeDate, 1),
    completed: normalizeCompleted({}, blockAges),
    record: normalizeBlockRecord({
      mixName: params.get("mixName"),
      recipeMaterials: blockRecipeMaterials,
      recipeValues,
      waterBinderRatio: params.get("waterBinderRatio"),
      slump: params.get("slump"),
      gradationCoefficient,
      weighingTemplate,
      totalWithoutWater: params.get("totalWithoutWater") || WEIGHING_TEMPLATES[weighingTemplate].totalWithoutWater,
      gradationTemplate,
      gradationWeights,
      gangueAggregateId: selectedGangueId,
      gangueAggregateName: selectedGangueName
    }, blockAges, blockMetrics, blockRecipeMaterials),
    strength: String(params.get("strength") || "").trim(),
    note: String(params.get("note") || "").trim()
  }, ...getTestBlocks(content)];
  await saveContent(content);
  redirect(res, "试块已登记，日历已更新", redirectBase, `block-${blockId}`);
}

async function handleDeleteBlock(req, res, redirectBase = BASE_PATH) {
  const params = new URLSearchParams((await parseBody(req)).toString("utf8"));
  const id = String(params.get("id") || "");
  const content = await readContent();
  content.testBlocks = getTestBlocks(content).filter((item) => item.id !== id);
  await saveContent(content);
  redirect(res, "试块记录已删除", redirectBase);
}

async function handleUpdateRecipeMaterialLibrary(req, res, redirectBase = WORK_PATH) {
  const params = new URLSearchParams((await parseBody(req)).toString("utf8"));
  const content = await readContent();
  const enabledRaw = new Set(params.getAll("enabledRecipeMaterials").map((item) => String(item || "").trim()).filter(Boolean));
  const deleteIds = new Set(params.getAll("deleteRecipeMaterials").map((item) => String(item || "").trim()).filter(Boolean));
  deleteIds.forEach((id) => enabledRaw.delete(id));
  const managedMaterials = allManagedRecipeMaterials(content);
  const selectedMaterials = managedMaterials
    .filter((material) => enabledRaw.has(material.id) && !deleteIds.has(material.id))
    .map((material) => material.custom
      ? { ...material, category: normalizeRecipeMaterialCategory(params.get(`materialCategory_${material.id}`), recipeMaterialCategory(material)) }
      : { ...material, category: recipeMaterialCategory(material) });
  const newMaterials = normalizeRecipeMaterials([], params.get("newRecipeMaterials"), {
    fallbackToDefault: false,
    customCategory: params.get("newRecipeMaterialCategory")
  });
  const enabledMaterials = normalizeRecipeMaterials([...selectedMaterials, ...newMaterials], "", { fallbackToDefault: false });
  const enabledIds = new Set(enabledMaterials.map((material) => material.id));
  content.disabledRecipeMaterialIds = BUILTIN_RECIPE_MATERIALS
    .map((material) => material.id)
    .filter((id) => !enabledIds.has(id) || deleteIds.has(id));
  content.recipeMaterialLibrary = enabledMaterials
    .filter((material) => material.custom && !deleteIds.has(material.id))
    .sort((a, b) => {
      const byCategory = RECIPE_MATERIAL_CATEGORIES.findIndex((category) => category.id === recipeMaterialCategory(a))
        - RECIPE_MATERIAL_CATEGORIES.findIndex((category) => category.id === recipeMaterialCategory(b));
      return byCategory || a.label.localeCompare(b.label, "zh-CN");
    });
  await saveContent(content);
  redirect(res, "材料库已保存", redirectBase);
}

function sampleMeasurementsFromParams(params, ageKey, metricId) {
  return [0, 1, 2].map((index) => {
    const pressureKn = String(params.get(`samplePressure_${ageKey}_${metricId}_${index}`) || "").trim();
    const areaMm2 = String(params.get(`sampleArea_${ageKey}_${metricId}_${index}`) || "").trim();
    const computed = strengthFromPressureArea(pressureKn, areaMm2);
    const strengthMpa = computed || String(params.get(`sampleStrength_${ageKey}_${metricId}_${index}`) || "").trim();
    return {
      pressureKn,
      areaMm2,
      strengthMpa,
      failureMode: String(params.get(`sampleFailureMode_${ageKey}_${metricId}_${index}`) || "").trim(),
      remark: String(params.get(`sampleRemark_${ageKey}_${metricId}_${index}`) || "").trim()
    };
  }).filter((item) => item.pressureKn || item.areaMm2 || item.strengthMpa || item.failureMode || item.remark);
}

async function handleUpdateBlockRecord(req, res, redirectBase = WORK_PATH) {
  const params = new URLSearchParams((await parseBody(req)).toString("utf8"));
  const id = String(params.get("id") || "");
  if (!id) throw Object.assign(new Error("missing block id"), { statusCode: 400 });
  const baseRecord = {
    mixName: params.get("mixName"),
    cement: params.get("cement"),
    water: params.get("water"),
    sand: params.get("sand"),
    stone: params.get("stone"),
    admixture: params.get("admixture"),
    flyAsh: params.get("flyAsh"),
    mineralPowder: params.get("mineralPowder"),
    otherMaterials: params.get("otherMaterials"),
    waterBinderRatio: params.get("waterBinderRatio"),
    slump: params.get("slump"),
    gradationCoefficient: params.get("gradationCoefficient"),
    weighingTemplate: params.get("weighingTemplate"),
    totalWithoutWater: params.get("totalWithoutWater"),
    gradationTemplate: params.get("gradationTemplate"),
    gangueAggregateId: params.get("gangueAggregateId"),
    recipeNote: params.get("recipeNote"),
    compressionStrength: params.get("compressionStrength"),
    flexuralStrength: params.get("flexuralStrength"),
    testDate: params.get("testDate"),
    resultNote: params.get("resultNote")
  };
  let found = false;
  const content = await readContent();
  const selectedGangueId = String(params.get("gangueAggregateId") || "").trim();
  const selectedGangueName = selectedGangueId ? coalGangueNameById(content, selectedGangueId) : "";
  updateRecipeMaterialLibraryFromParams(content, params);
  content.testBlocks = getTestBlocks(content).map((block) => {
    if (block.id !== id) return block;
    found = true;
    const editedAges = normalizeAges(params.get("ages"));
    const nextAges = editedAges.length ? editedAges : block.ages;
    const nextMadeDate = normalizeDateValue(params.get("madeDate") || block.madeDate);
    const nextDemoldDate = optionalDateValue(params.get("demoldDate")) || addDays(nextMadeDate, 1);
    const nextCategory = normalizeBlockCategory(params.get("blockCategory"), block.blockCategory || "road");
    const nextWeighingTemplate = normalizeWeighingTemplate(params.get("weighingTemplate"), nextCategory);
    const nextGradationTemplate = normalizeGradationTemplate(params.get("gradationTemplate"));
    const nextGradationCoefficient = gradationCoefficientForTemplate(nextCategory, nextGradationTemplate) || String(params.get("gradationCoefficient") || "").trim();
    const nextMetrics = metricsFromParams(params);
    const nextRecipeMaterials = templateRecipeMaterials(nextWeighingTemplate, recipeMaterialsFromParams(params, content, block.recipeMaterials || (block.record && block.record.recipeMaterials)));
    const recipeValues = {};
    nextRecipeMaterials.forEach((material) => {
      recipeValues[material.id] = params.get(`recipe_${material.id}`);
    });
    const finalRecipeValues = params.get("templateApplied") === "1"
      ? applyWeighingTemplateToRecipeValues(recipeValues, nextRecipeMaterials, nextWeighingTemplate)
      : recipeValues;
    const gradationWeights = blockGradationWeightsFromParams(params, nextCategory, nextGradationTemplate, block.record && block.record.gradationWeights);
    const results = {};
    nextAges.forEach((age) => {
      const key = String(age);
      const metricValues = {};
      const metricResults = {};
      nextMetrics.forEach((metric) => {
        const legacyName = metric.id === "compressionStrength"
          ? `resultCompression_${key}`
          : metric.id === "flexuralStrength"
            ? `resultFlexural_${key}`
            : "";
        const sampleMeasurements = sampleMeasurementsFromParams(params, key, metric.id);
        const sampleValues = sampleMeasurements.map((sample) => sample.strengthMpa).filter((value) => parseMeasurementNumber(value) !== null);
        const manualMean = sampleValues.length ? "" : (params.get(`manualMean_${key}_${metric.id}`) || params.get(`metric_${key}_${metric.id}`) || (legacyName ? params.get(legacyName) : ""));
        const entry = normalizeMetricResultEntry({
          age,
          metric: metric.id,
          dueDate: addDays(nextMadeDate, age),
          sampleMeasurements,
          sampleValues,
          manualMean,
          failureMode: sampleMeasurements.map((sample) => sample.failureMode).filter(Boolean).join("；"),
          remark: sampleMeasurements.map((sample) => sample.remark).filter(Boolean).join("；")
        }, manualMean, { age, metric: metric.id, dueDate: addDays(nextMadeDate, age) });
        metricResults[metric.id] = entry;
        metricValues[metric.id] = entry.mean || entry.manualMean || "";
      });
      results[key] = {
        dueDate: addDays(nextMadeDate, age),
        testDate: params.get(`resultTestDate_${key}`),
        compressionStrength: metricValues.compressionStrength || "",
        flexuralStrength: metricValues.flexuralStrength || "",
        resultNote: params.get(`resultNote_${key}`),
        metrics: metricValues,
        metricResults
      };
    });
    const nextRecord = normalizeBlockRecord({
      ...baseRecord,
      gradationCoefficient: nextGradationCoefficient,
      gangueAggregateName: selectedGangueName,
      recipeMaterials: nextRecipeMaterials,
      recipeValues: finalRecipeValues,
      metrics: nextMetrics,
      gradationTemplate: nextGradationTemplate,
      gradationWeights,
      results
    }, nextAges, nextMetrics, nextRecipeMaterials);
    return {
      ...block,
      name: String(params.get("blockName") || block.name || "").trim() || block.name,
      madeDate: nextMadeDate,
      quantity: Math.max(1, Number.parseInt(params.get("quantity"), 10) || block.quantity || 1),
      ages: nextAges,
      demoldDate: nextDemoldDate,
      completed: normalizeCompleted(block.completed, nextAges),
      strength: String(params.get("strength") || "").trim(),
      note: String(params.get("note") || "").trim(),
      blockCategory: nextCategory,
      metrics: nextMetrics,
      recipeMaterials: nextRecipeMaterials,
      record: nextRecord
    };
  });
  if (!found) throw Object.assign(new Error("block not found"), { statusCode: 404 });
  await saveContent(content);
  redirect(res, "试块档案已保存", redirectBase, `record-${id}`);
}

async function handleToggleTask(req, res, redirectBase = WORK_PATH) {
  const params = new URLSearchParams((await parseBody(req)).toString("utf8"));
  const id = String(params.get("id") || "");
  const taskType = String(params.get("taskType") || "");
  const age = String(params.get("age") || "");
  const done = params.get("done") === "1";
  const returnAnchor = safeReturnAnchor(params.get("returnAnchor"), id ? `record-${id}` : "calendar");
  const content = await readContent();
  content.testBlocks = getTestBlocks(content).map((block) => {
    if (block.id !== id) return block;
    const completed = normalizeCompleted(block.completed, block.ages);
    if (taskType === "demold") {
      completed.demold = done;
    }
    if (taskType === "age" && age) {
      completed.ages[String(age)] = done;
    }
    return { ...block, completed };
  });
  await saveContent(content);
  redirect(res, done ? "任务已标记完成" : "任务已取消完成", redirectBase, returnAnchor);
}

async function handleDeleteReminder(req, res, redirectBase = WORK_PATH) {
  const params = new URLSearchParams((await parseBody(req)).toString("utf8"));
  const id = String(params.get("id") || "");
  const taskType = String(params.get("taskType") || "");
  const age = String(params.get("age") || "");
  const returnAnchor = safeReturnAnchor(params.get("returnAnchor"), id ? `record-${id}` : "calendar");
  if (!id || !taskType) throw Object.assign(new Error("missing reminder target"), { statusCode: 400 });
  const content = await readContent();
  let found = false;
  content.testBlocks = getTestBlocks(content).map((block) => {
    if (block.id !== id) return block;
    found = true;
    const completed = normalizeCompleted(block.completed, block.ages);
    if (taskType === "demold") completed.deleted.demold = true;
    if (taskType === "age" && age) completed.deleted.ages[String(age)] = true;
    return { ...block, completed };
  });
  if (!found) throw Object.assign(new Error("block not found"), { statusCode: 404 });
  await saveContent(content);
  redirect(res, "提醒已删除", redirectBase, returnAnchor);
}

async function handleDismissAnomalies(req, res, redirectBase = WORK_PATH) {
  const params = new URLSearchParams((await parseBody(req)).toString("utf8"));
  const ids = normalizeDismissedAnomalyIds(params.getAll("anomalyIds"));
  if (!ids.length) return redirect(res, "先勾选要删除的异常提醒", redirectBase, "anomalies");
  const content = await readContent();
  const merged = normalizeDismissedAnomalyIds([...(content.dismissedAnomalies || []), ...ids]);
  content.dismissedAnomalies = merged.slice(-500);
  await saveContent(content);
  redirect(res, `已删除 ${ids.length} 条异常提醒`, redirectBase, "anomalies");
}

async function handleSendReminder(req, res) {
  const content = await readContent();
  try {
    await sendReminderEmail(content, { force: true });
    redirect(res, "提醒邮件已发送", WORK_PATH);
  } catch (error) {
    const reason = error.responseCode === 535 ? "QQ 邮箱认证失败，请重新确认 SMTP 授权码" : "邮件发送失败，请检查 SMTP 配置";
    redirect(res, reason, WORK_PATH);
  }
}

async function route(req, res) {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname === "/health") return send(res, 200, "ok", "text/plain; charset=utf-8");
  if (isPrivatePath(url.pathname)) return handlePrivateGallery(req, res, url);
  if (url.pathname === BASE_PATH) {
    res.writeHead(308, { Location: `${BASE_PATH}/` });
    return res.end();
  }
  if (url.pathname === WORK_PATH) {
    res.writeHead(308, { Location: `${WORK_PATH}/` });
    return res.end();
  }

  if (url.pathname.startsWith(`${WORK_PATH}/`)) {
    if (url.pathname === `${WORK_PATH}/login`) return handleCustomLogin(req, res, url, "work");
    if (url.pathname === `${WORK_PATH}/logout`) return handleCustomLogout(res, "work");
    if (!ensureAuthed(req, res, url, "work")) return;
    if ((req.method === "GET" || req.method === "HEAD") && (url.pathname === WORK_FILE_PATH || url.pathname.startsWith(`${WORK_FILE_PATH}/`))) {
      return serveStaticFromPrefix(req, res, url.pathname, WORK_FILE_PATH, WORK_UPLOAD_DIR);
    }
    if ((req.method === "GET" || req.method === "HEAD") && url.pathname === `${WORK_PATH}/`) {
      const content = await readContent();
      return sendProtectedHtml(req, res, 200, renderWorkspaceV3(content, url.searchParams.get("msg") || ""));
    }
    if (req.method === "POST" && !(await verifyCsrfRequest(req, res, url))) return;
    if (req.method === "POST" && url.pathname === `${WORK_PATH}/add-block`) return handleAddBlock(req, res, WORK_PATH);
    if (req.method === "POST" && url.pathname === `${WORK_PATH}/delete-block`) return handleDeleteBlock(req, res, WORK_PATH);
    if (req.method === "POST" && url.pathname === `${WORK_PATH}/toggle-task`) return handleToggleTask(req, res, WORK_PATH);
    if (req.method === "POST" && url.pathname === `${WORK_PATH}/delete-reminder`) return handleDeleteReminder(req, res, WORK_PATH);
    if (req.method === "POST" && url.pathname === `${WORK_PATH}/dismiss-anomalies`) return handleDismissAnomalies(req, res, WORK_PATH);
    if (req.method === "POST" && url.pathname === `${WORK_PATH}/update-material-library`) return handleUpdateRecipeMaterialLibrary(req, res, WORK_PATH);
    if (req.method === "POST" && url.pathname === `${WORK_PATH}/add-gangue`) return handleAddGangue(req, res, WORK_PATH);
    if (req.method === "POST" && url.pathname === `${WORK_PATH}/update-gangue`) return handleUpdateGangue(req, res, WORK_PATH);
    if (req.method === "POST" && url.pathname === `${WORK_PATH}/delete-gangue`) return handleDeleteGangue(req, res, WORK_PATH);
    if (req.method === "POST" && url.pathname === `${WORK_PATH}/update-block-record`) return handleUpdateBlockRecord(req, res, WORK_PATH);
    if (req.method === "POST" && url.pathname === `${WORK_PATH}/upload-lab-image`) return handleUploadLabImage(req, res, WORK_PATH);
    if (req.method === "POST" && url.pathname === `${WORK_PATH}/delete-lab-image`) return handleDeleteLabImage(req, res, WORK_PATH);
    if (req.method === "POST" && url.pathname === `${WORK_PATH}/export-blocks`) return handleExportBlocks(req, res, WORK_PATH);
    if (req.method === "POST" && url.pathname === `${WORK_PATH}/send-reminder`) return handleSendReminder(req, res);
    return send(res, 404, "Not found", "text/plain; charset=utf-8");
  }

  if (!url.pathname.startsWith(`${BASE_PATH}/`)) return send(res, 404, "Not found", "text/plain; charset=utf-8");

  if (url.pathname === `${BASE_PATH}/login`) return handleCustomLogin(req, res, url, "admin");
  if (url.pathname === `${BASE_PATH}/logout`) return handleCustomLogout(res, "admin");
  if (!ensureAuthed(req, res, url, "admin")) return;

  if ((req.method === "GET" || req.method === "HEAD") && url.pathname === `${BASE_PATH}/`) {
    const content = await readContent();
    return sendProtectedHtml(req, res, 200, renderAdmin(content, url.searchParams.get("msg") || ""));
  }
  if (req.method === "POST" && !(await verifyCsrfRequest(req, res, url))) return;
  if (req.method === "POST" && url.pathname === `${BASE_PATH}/save`) {
    const previous = await readContent();
    const params = new URLSearchParams((await parseBody(req)).toString("utf8"));
    await saveContent(contentFromForm(params, previous));
    return redirect(res, "内容已保存并发布");
  }
  if (req.method === "POST" && url.pathname === `${BASE_PATH}/upload`) return handleUpload(req, res);
  if (req.method === "POST" && url.pathname === `${BASE_PATH}/delete-image`) return handleDeleteImage(req, res);
  if (req.method === "POST" && url.pathname === `${BASE_PATH}/rename-album`) return handleRenameAlbum(req, res);
  if (req.method === "POST" && url.pathname === `${BASE_PATH}/add-block`) return handleAddBlock(req, res);
  if (req.method === "POST" && url.pathname === `${BASE_PATH}/delete-block`) return handleDeleteBlock(req, res);
  if (req.method === "POST" && url.pathname === `${BASE_PATH}/toggle-task`) return handleToggleTask(req, res, BASE_PATH);
  if (req.method === "POST" && url.pathname === `${BASE_PATH}/update-block-record`) return handleUpdateBlockRecord(req, res, BASE_PATH);
  if (req.method === "POST" && url.pathname === `${BASE_PATH}/export-blocks`) return handleExportBlocks(req, res, BASE_PATH);
  return send(res, 404, "Not found", "text/plain; charset=utf-8");
}

async function bootstrap() {
  await ensureDirs();
  await ensureSessionSecret();
  await saveContent(await readContent());
  checkDailyReminder().catch((error) => console.error("daily reminder failed", error));
  setInterval(() => {
    checkDailyReminder().catch((error) => console.error("daily reminder failed", error));
  }, REMINDER_INTERVAL_MS).unref();
  http.createServer((req, res) => {
    route(req, res).catch((error) => {
      const status = error.statusCode || 500;
      send(res, status, status === 500 ? "Internal server error" : error.message, "text/plain; charset=utf-8");
      console.error(error);
    });
  }).listen(PORT, "127.0.0.1", () => {
    console.log(`xx520 admin listening on http://127.0.0.1:${PORT}${BASE_PATH}/ and ${WORK_PATH}/`);
  });
}

bootstrap().catch((error) => {
  console.error(error);
  process.exit(1);
});

