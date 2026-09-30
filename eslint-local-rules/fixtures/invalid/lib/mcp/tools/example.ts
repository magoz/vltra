import { readFile } from 'fs/promises'
import test from 'node:test'
import { NodeHttpClient } from '@effect/platform-node/NodeHttpClient'
export { writeFile } from 'fs/promises'
export * from 'node:fs'

void import('node:fs')
void import(moduleName)
import fs = require('node:fs')
require('fs/promises')
fetch('https://example.com')
globalThis.fetch('https://example.com')
window['fetch']('https://example.com')

export { fs, NodeHttpClient, readFile, test }
