// Loads every test file, then runs them.
import { run } from "./harness.js";
import "./compose.test.js";
import "./weather.test.js";
import "./sky.test.js";
import "./engine.test.js";
await run();
