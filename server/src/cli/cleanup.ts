import { cleanupPhotoNow, runCleanup } from "../services/cleanup.js";
import { prisma } from "../db/prisma.js";

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function optionValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

async function main(): Promise<void> {
  const photoId = optionValue("--photo");
  let summary;

  if (photoId) {
    summary = await cleanupPhotoNow(photoId);
  } else {
    const all =
      hasFlag("--all") ||
      (!hasFlag("--retention") && !hasFlag("--orphans") && !hasFlag("--photo"));
    const orphansOnly = hasFlag("--orphans");
    summary = await runCleanup({
      all,
      orphansOnly,
      retentionOnly: hasFlag("--retention"),
    });
  }

  console.log(JSON.stringify(summary, null, 2));
  await prisma.$disconnect();
  if (summary.errors.length > 0) process.exitCode = 1;
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});
