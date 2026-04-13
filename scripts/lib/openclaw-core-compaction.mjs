import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export const defaultDistDir =
  "/home/hirakitomohiko/.volta/tools/image/node/24.12.0/lib/node_modules/openclaw/dist";

const queuedRenderSource =
  "renderItem: (item, idx) => `---\\nQueued #" +
  "${" +
  "idx + 1" +
  "}" +
  "\\n" +
  "${" +
  "item.prompt" +
  "}`.trim()";
const queuedRenderPatched =
  "renderItem: (item, idx) => `---\\nQ" +
  "${" +
  "idx + 1" +
  "}" +
  "\\n" +
  "${" +
  "item.prompt" +
  "}`.trim()";

export const patchSpecs = [
  {
    file: "get-reply-bONH39Y6.js",
    description: "minify trusted inbound metadata JSON",
    replacements: [
      {
        from: "JSON.stringify(payload, null, 2)",
        to: "JSON.stringify(payload)",
      },
    ],
  },
  {
    file: "heartbeat-runner-U2x6TbnN.js",
    description: "shorten reminder and async notice boilerplate",
    replacements: [
      {
        from: 'if (!deliverToUser) return "Scheduled reminder:\\n\\n" + eventText + "\\n\\nHandle internally. Do not relay unless explicitly requested.";',
        to: 'if (!deliverToUser) return "Scheduled reminder:\\n\\n" + eventText + "\\n\\nHandle internally. Do not relay unless requested.";',
      },
      {
        from: 'return "Scheduled reminder:\\n\\n" + eventText + "\\n\\nRelay to the user only if it needs user-facing follow-up.";',
        to: 'return "Scheduled reminder:\\n\\n" + eventText + "\\n\\nRelay only if user-facing follow-up is needed.";',
      },
      {
        from: 'if (!(opts?.deliverToUser ?? true)) return "Async command completed. Result is in the system messages above. Handle internally unless explicitly requested.";',
        to: 'if (!(opts?.deliverToUser ?? true)) return "Async command completed. Result is in system messages above. Handle internally unless requested.";',
      },
      {
        from: 'return "Async command completed. Result is in the system messages above. Relay the relevant result to the user.";',
        to: 'return "Async command completed. Result is in system messages above. Relay relevant results to the user.";',
      },
    ],
  },
  {
    file: "queue-AttL4x6M.js",
    description: "shorten queued-message framing",
    replacements: [
      {
        from: 'title: "[Queued messages while agent was busy]",',
        to: 'title: "[Queued messages while busy]",',
      },
      {
        from: queuedRenderSource,
        to: queuedRenderPatched,
      },
    ],
  },
  {
    file: "session-transcript-repair-BsMojl-5.js",
    description: "shorten synthetic repair error text",
    replacements: [
      {
        from: '"[openclaw] missing tool result in session history; inserted synthetic error result for transcript repair."',
        to: '"[openclaw] missing tool result in history; inserted synthetic repair result."',
      },
    ],
  },
  {
    file: "get-reply-bONH39Y6.js",
    description: "shorten reply media hint",
    replacements: [
      {
        from: 'const REPLY_MEDIA_HINT = "To send an image back, prefer the message tool (media/path/filePath). If you must inline, use MEDIA:https://example.com/image.jpg (spaces ok, quote if needed) or a safe relative path like MEDIA:./image.jpg. Avoid absolute paths (MEDIA:/...) and ~ paths - they are blocked for security. Keep caption in the text body.";',
        to: 'const REPLY_MEDIA_HINT = "For image replies, prefer the message tool (media/path/filePath). If inlining, use MEDIA:https://example.com/image.jpg or MEDIA:./image.jpg. Absolute and ~ paths are blocked. Keep captions in the text body.";',
      },
    ],
  },
];

export function resolveDistDir(argv) {
  const index = argv.indexOf("--dist");
  if (index >= 0) {
    const value = argv[index + 1];
    if (!value) throw new Error("--dist requires a path");
    return value;
  }
  return defaultDistDir;
}

function countOccurrences(source, needle) {
  if (!needle) return 0;
  let count = 0;
  let index = 0;
  while (true) {
    const found = source.indexOf(needle, index);
    if (found === -1) return count;
    count += 1;
    index = found + needle.length;
  }
}

async function readSource(distDir, file) {
  const filePath = path.join(distDir, file);
  const source = await readFile(filePath, "utf8");
  return { filePath, source };
}

export async function applyPatchFile(distDir, spec) {
  const { filePath, source: original } = await readSource(distDir, spec.file);
  let source = original;
  let changed = false;

  for (const replacement of spec.replacements) {
    const toCount = countOccurrences(source, replacement.to);
    if (toCount === 1 && countOccurrences(source, replacement.from) === 0) continue;
    if (toCount > 0 && countOccurrences(source, replacement.from) === 0) {
      throw new Error(
        `Replacement already present multiple times in ${spec.file}: ${replacement.to}`,
      );
    }
    const fromCount = countOccurrences(source, replacement.from);
    if (fromCount !== 1) {
      throw new Error(
        `Expected exactly one match in ${spec.file} for ${replacement.from}, found ${fromCount}`,
      );
    }
    source = source.replace(replacement.from, replacement.to);
    changed = true;
  }

  if (changed) {
    await writeFile(filePath, source, "utf8");
  }

  return { filePath, changed };
}

export async function applyAllPatches(distDir) {
  const results = [];
  for (const spec of patchSpecs) {
    results.push(await applyPatchFile(distDir, spec));
  }
  return results;
}

export async function verifyAllPatches(distDir) {
  const results = [];
  let ok = true;

  for (const spec of patchSpecs) {
    const { filePath, source } = await readSource(distDir, spec.file);
    for (const replacement of spec.replacements) {
      const fromCount = countOccurrences(source, replacement.from);
      const toCount = countOccurrences(source, replacement.to);
      const passes = fromCount === 0 && toCount === 1;
      results.push({
        filePath,
        from: replacement.from,
        to: replacement.to,
        fromCount,
        toCount,
        passes,
      });
      if (!passes) ok = false;
    }
  }

  return { ok, results };
}
