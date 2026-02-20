#!/usr/bin/env bun

import fs from "node:fs"
import path from "node:path"
import { createRequire } from "node:module"

const req = createRequire(import.meta.url)

const resolve = () => {
  try {
    return path.dirname(req.resolve("node-pty/package.json"))
  } catch {
    return
  }
}

export const fixNodePtyHelper = () => {
  const root = resolve()
  if (!root) return []

  const files = [
    path.join(root, "prebuilds", "darwin-arm64", "spawn-helper"),
    path.join(root, "prebuilds", "darwin-x64", "spawn-helper"),
    path.join(root, "build", "Release", "spawn-helper"),
    path.join(root, "build", "Debug", "spawn-helper"),
  ]

  return files.flatMap((file) => {
    if (!fs.existsSync(file)) return []
    const mode = fs.statSync(file).mode
    const next = mode | 0o111
    if (mode === next) return []
    fs.chmodSync(file, next)
    return [file]
  })
}

if (import.meta.main) {
  const changed = fixNodePtyHelper()
  if (!changed.length) process.exit(0)
  console.log(`updated node-pty spawn-helper permissions (${changed.length})`)
  for (const file of changed) {
    console.log(`- ${file}`)
  }
}
