import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(import.meta.url);
const packageRoot = join(dirname(here), "..");
const packageJsonPath = join(packageRoot, "package.json");

export function compareSemver(a, b) {
	const pa = a.split(".").map((n) => Number(n));
	const pb = b.split(".").map((n) => Number(n));
	for (let i = 0; i < 3; i++) {
		const da = pa[i] ?? 0;
		const db = pb[i] ?? 0;
		if (da !== db) return da < db ? -1 : 1;
	}
	return 0;
}

export function bumpPatch(version) {
	const [major, minor, patch] = version.split(".").map((n) => Number(n));
	return `${major}.${minor}.${(patch ?? 0) + 1}`;
}

/** Null means keep local: first publish, or local is already ahead. */
export function nextPublishVersion(local, published) {
	if (published === null) return null;
	if (compareSemver(local, published) > 0) return null;
	return bumpPatch(published);
}

export function applyVersion(raw, next) {
	const updated = raw.replace(/("version":\s*")([^"]+)(")/, `$1${next}$3`);
	if (updated === raw) {
		throw new Error("Could not find a version field to bump in package.json");
	}
	return updated;
}

function pnpm(args, inherit) {
	return spawnSync("pnpm", args, {
		encoding: "utf8",
		stdio: inherit ? "inherit" : ["ignore", "pipe", "pipe"],
		shell: process.platform === "win32",
		env: process.env,
		cwd: packageRoot,
	});
}

function ensureLogin() {
	const who = pnpm(["whoami"], false);
	if (who.status === 0) {
		const name = (who.stdout ?? "").trim();
		if (name) console.log(`npm: ${name}`);
		return;
	}
	console.log("Not logged in to npm. Opening login…");
	const login = pnpm(["login"], true);
	if (login.status !== 0) {
		console.error("npm login failed.");
		process.exit(1);
	}
	const again = pnpm(["whoami"], false);
	if (again.status !== 0) {
		console.error("Still not logged in after pnpm login.");
		process.exit(1);
	}
	const name = (again.stdout ?? "").trim();
	if (name) console.log(`npm: ${name}`);
}

async function publishedVersion(name) {
	const res = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}/latest`);
	if (res.status === 404) return null;
	if (!res.ok) {
		throw new Error(`npm registry ${res.status} for ${name}`);
	}
	const body = await res.json();
	if (!body.version) {
		throw new Error(`npm latest for ${name} had no version`);
	}
	return body.version;
}

async function bumpIfNeeded() {
	const raw = readFileSync(packageJsonPath, "utf8");
	const pkg = JSON.parse(raw);
	const published = await publishedVersion(pkg.name);
	const next = nextPublishVersion(pkg.version, published);
	if (!next) {
		console.log(
			`Publishing ${pkg.version} (npm latest: ${published ?? "none"}).`,
		);
		return;
	}
	writeFileSync(packageJsonPath, applyVersion(raw, next));
	console.log(
		`Version ${pkg.version} is on npm already (latest ${published}). Bumped to ${next}.`,
	);
}

export async function runPublishGate() {
	ensureLogin();
	await bumpIfNeeded();
}

const entry = process.argv[1];
if (entry && resolve(entry) === resolve(here)) {
	runPublishGate().catch((err) => {
		console.error(err instanceof Error ? err.message : err);
		process.exit(1);
	});
}
