import { CarDynamics } from '../src/car/dynamics.js';
import { SCENARIOS, runScenario } from '../src/car/scenarios.js';
const names = process.argv.slice(2);
for (const name of names.length ? names : Object.keys(SCENARIOS)) {
  const car = new CarDynamics(undefined, SCENARIOS[name].ground);
  const t0 = Date.now();
  const r = runScenario(car, SCENARIOS[name]);
  console.log(name, JSON.stringify(r, (k, v) => (typeof v === 'number' ? +v.toFixed(3) : v)), (Date.now() - t0) + 'ms');
}
