/**
 * Test entry point: imports every suite so one command runs the whole set.
 *
 * Run with `npm test` (which is `node --experimental-strip-types
 * --no-warnings src/tests/index.test.ts`). Individual suites stay runnable on
 * their own for focused debugging.
 * @module dsh-vcs-timeline/tests/index.test
 */

import './security.test.ts'
import './discovery.test.ts'
import './operation-service.test.ts'
import './storage.test.ts'
import './audit.test.ts'
import './git.unit.test.ts'
import './git.integration.test.ts'
import './svn.unit.test.ts'
import './client.format.test.ts'
import './client.render.test.ts'
