import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Single source of truth for the Quasar extension contract. Generates the
// three language artifacts (TS / Rust / Python) plus schema copies into a
// consumer repository (the quasar shell).
//
// Usage:
//   node generate-extension-sdk.mjs --ts <path> --rust <path> --python <path> --schema-copy-dir <dir>
//
//   --ts              output for galaxy-core.generated.ts
//   --rust            output for extension_core_api/generated.rs
//   --python          output for extension_core_api_generated.py
//   --schema-copy-dir dir that receives core-api.schema.json + manifest.schema.json
const sdkRoot = dirname(fileURLToPath(import.meta.url));

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1 || index + 1 >= process.argv.length) {
    throw new Error(`Missing required argument ${flag} <path>`);
  }
  return resolve(process.argv[index + 1]);
}

const typescriptOutputPath = argValue("--ts");
const rustOutputPath = argValue("--rust");
const pythonOutputPath = argValue("--python");
const schemaCopyDir = argValue("--schema-copy-dir");
const schemaPath = resolve(sdkRoot, "schemas/core-api.schema.json");

const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
const actions = Array.isArray(schema.actions) ? schema.actions : [];
const typeSchemas = schema.types && typeof schema.types === "object" ? schema.types : {};

if (typeof schema.apiVersion !== "string" || schema.apiVersion.trim() === "") {
  throw new Error("core-api.schema.json must define apiVersion");
}

const seenKeys = new Set();
const seenNames = new Set();
for (const action of actions) {
  if (!action || typeof action !== "object") {
    throw new Error("Every action must be an object");
  }
  for (const field of ["key", "name", "permission", "payloadType", "resultDataType"]) {
    if (typeof action[field] !== "string" || action[field].trim() === "") {
      throw new Error(`Every action must define a non-empty ${field}`);
    }
  }
  if (!typeSchemas[action.payloadType]) {
    throw new Error(`Action ${action.name} references unknown payloadType ${action.payloadType}`);
  }
  if (!typeSchemas[action.resultDataType]) {
    throw new Error(`Action ${action.name} references unknown resultDataType ${action.resultDataType}`);
  }
  if (seenKeys.has(action.key)) {
    throw new Error(`Duplicate action key: ${action.key}`);
  }
  if (seenNames.has(action.name)) {
    throw new Error(`Duplicate action name: ${action.name}`);
  }
  seenKeys.add(action.key);
  seenNames.add(action.name);
}

const actionLines = actions
  .map((action) => `  ${action.key}: ${JSON.stringify(action.name)},`)
  .join("\n");
const permissionLines = actions
  .map((action) => `  ${JSON.stringify(action.name)}: ${JSON.stringify(action.permission)},`)
  .join("\n");

function constantName(action) {
  return `CORE_ACTION_${action.key.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toUpperCase()}`;
}

function typeName(name) {
  if (!/^[A-Z][A-Za-z0-9]*$/.test(name)) {
    throw new Error(`Invalid type name: ${name}`);
  }
  return name;
}

function tsPropertyKey(key) {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? key : JSON.stringify(key);
}

function schemaToTs(value) {
  if (!value || typeof value !== "object" || !value.type) {
    return "unknown";
  }
  if (Array.isArray(value.enum) && value.enum.length > 0) {
    return value.enum.map((item) => JSON.stringify(item)).join(" | ");
  }
  if (Array.isArray(value.type)) {
    return value.type.map((item) => schemaToTs({ ...value, type: item })).join(" | ");
  }
  switch (value.type) {
    case "string":
      return "string";
    case "integer":
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "array":
      return `${schemaToTs(value.items ?? {})}[]`;
    case "object": {
      const properties = value.properties && typeof value.properties === "object" ? value.properties : {};
      const required = new Set(Array.isArray(value.required) ? value.required : []);
      const propertyEntries = Object.entries(properties);
      if (propertyEntries.length === 0) {
        return value.additionalProperties === true ? "Record<string, unknown>" : "Record<string, never>";
      }
      const lines = propertyEntries.map(([key, propertySchema]) => {
        const optional = required.has(key) ? "" : "?";
        return `  ${tsPropertyKey(key)}${optional}: ${schemaToTs(propertySchema)};`;
      });
      if (value.additionalProperties === true) {
        lines.push("  [key: string]: unknown;");
      }
      return `{\n${lines.join("\n")}\n}`;
    }
    default:
      return "unknown";
  }
}

const typeLines = Object.entries(typeSchemas)
  .map(([name, value]) => `export type ${typeName(name)} = ${schemaToTs(value)};`)
  .join("\n\n");
const payloadMapLines = actions
  .map((action) => `  ${JSON.stringify(action.name)}: ${typeName(action.payloadType)};`)
  .join("\n");
const resultMapLines = actions
  .map((action) => `  ${JSON.stringify(action.name)}: ${typeName(action.resultDataType)};`)
  .join("\n");

const outputTypescript = `/**
 * @author Bui Trong Hieu
 * @email kevinbui210191@gmail.com
 * @create date 2026-05-13
 * @modify date 2026-05-13
 * @desc Generated constants for Galaxy Core Extension API. Do not edit by hand.
 */

export const GALAXY_CORE_API_VERSION = ${JSON.stringify(schema.apiVersion)};

export const CORE_ACTIONS = {
${actionLines}
} as const;

export type CoreActionKey = keyof typeof CORE_ACTIONS;
export type CoreActionName = (typeof CORE_ACTIONS)[CoreActionKey];

export const CORE_ACTION_PERMISSIONS: Record<CoreActionName, string> = {
${permissionLines}
};

${typeLines}

export type CoreActionPayloads = {
${payloadMapLines}
};

export type CoreActionResultData = {
${resultMapLines}
};
`;

const rustConstants = actions
  .map((action) => `pub(crate) const ${constantName(action)}: &str = ${JSON.stringify(action.name)};`)
  .join("\n");
const rustMetadata = actions
  .map(
    (action) =>
      `    CoreActionMetadata { key: ${JSON.stringify(action.key)}, name: ${constantName(
        action,
      )}, permission: ${JSON.stringify(action.permission)}, payload_type: ${JSON.stringify(
        action.payloadType,
      )}, result_data_type: ${JSON.stringify(action.resultDataType)} },`,
  )
  .join("\n");
const rustMatch = actions
  .map((action) => `        ${constantName(action)} => Some(${JSON.stringify(action.permission)}),`)
  .join("\n");

const outputRust = `// @generated by scripts/generate-extension-sdk.mjs. Do not edit by hand.
#![allow(dead_code)]

pub(crate) const GALAXY_CORE_API_VERSION: &str = ${JSON.stringify(schema.apiVersion)};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct CoreActionMetadata {
    pub(crate) key: &'static str,
    pub(crate) name: &'static str,
    pub(crate) permission: &'static str,
    pub(crate) payload_type: &'static str,
    pub(crate) result_data_type: &'static str,
}

${rustConstants}

pub(crate) const CORE_ACTIONS: &[CoreActionMetadata] = &[
${rustMetadata}
];

pub(crate) fn core_action_permission(action: &str) -> Option<&'static str> {
    match action {
${rustMatch}
        _ => None,
    }
}

pub(crate) fn is_supported_core_action(action: &str) -> bool {
    core_action_permission(action).is_some()
}
`;

const pythonActions = actions
  .map((action) => `    ${JSON.stringify(action.key)}: ${JSON.stringify(action.name)},`)
  .join("\n");
const pythonPermissions = actions
  .map((action) => `    ${JSON.stringify(action.name)}: ${JSON.stringify(action.permission)},`)
  .join("\n");
const pythonPayloadTypes = actions
  .map((action) => `    ${JSON.stringify(action.name)}: ${JSON.stringify(action.payloadType)},`)
  .join("\n");
const pythonResultTypes = actions
  .map((action) => `    ${JSON.stringify(action.name)}: ${JSON.stringify(action.resultDataType)},`)
  .join("\n");

const outputPython = `# @generated by scripts/generate-extension-sdk.mjs. Do not edit by hand.

GALAXY_CORE_API_VERSION = ${JSON.stringify(schema.apiVersion)}

CORE_ACTIONS = {
${pythonActions}
}

CORE_ACTION_PERMISSIONS = {
${pythonPermissions}
}

CORE_ACTION_PAYLOAD_TYPES = {
${pythonPayloadTypes}
}

CORE_ACTION_RESULT_DATA_TYPES = {
${pythonResultTypes}
}


def core_action_permission(action: str) -> str | None:
    return CORE_ACTION_PERMISSIONS.get(action)
`;

writeFileSync(typescriptOutputPath, outputTypescript);
writeFileSync(rustOutputPath, outputRust);
execFileSync("rustfmt", [rustOutputPath], { stdio: "inherit" });
writeFileSync(pythonOutputPath, outputPython);
console.log(`Generated ${typescriptOutputPath}`);
console.log(`Generated ${rustOutputPath}`);
console.log(`Generated ${pythonOutputPath}`);

copyFileSync(resolve(sdkRoot, "schemas/core-api.schema.json"), resolve(schemaCopyDir, "core-api.schema.json"));
copyFileSync(resolve(sdkRoot, "schemas/manifest.schema.json"), resolve(schemaCopyDir, "manifest.schema.json"));
console.log("quasar-sdk: generated TS/Rust/Python artifacts + schema copies");
