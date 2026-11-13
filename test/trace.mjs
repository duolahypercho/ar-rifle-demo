import { CarDynamics } from '../src/car/dynamics.js';
import { SCENARIOS, preset } from '../src/car/scenarios.js';
const sc = SCENARIOS[process.argv[2]];
const car = new CarDynamics();
car.reset(0,0,0);
const s = {};
if (sc.setup) sc.setup.call(sc, car);
if (car._presetSpeed) preset(car, car._presetSpeed);
for (let i = 0; i < 60*(+process.argv[3]||6); i++) {
  const t = i/60 - 1.5;
  sc.control.call(sc, car, t, s);
  car.update(1/60);
  if (i % (+process.argv[4]||15) == 0) {
    const a = car.attitude();
    console.log(t.toFixed(2), 'v', (car.speed*3.6).toFixed(1), 'yawr', car.omega.y.toFixed(3), 'steer', (car.input.steerAngle??0).toFixed(3), 'thr', car.input.throttle.toFixed(2), 'brk', car.input.brake.toFixed(2), 'g', car.gearName, 'rpm', car.rpm.toFixed(0), 'lock', car.engine.locked, 'latG', (car.accBody.x/9.81).toFixed(2), 'lonG', (car.accBody.z/9.81).toFixed(2),
      'fz', car.wheels.map(w=>w.fz.toFixed(0)).join(','), 'k', car.wheels.map(w=>w.kappa.toFixed(2)).join(','), 'a', car.wheels.map(w=>(w.alpha*57.3).toFixed(1)).join(','), 'roll', (a.roll*57.3).toFixed(2), 'pitch', (a.pitch*57.3).toFixed(2), 'y', car.pos.y.toFixed(3));
  }
}
