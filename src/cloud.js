// (V4) A cloud of soft sprites in one draw call. The car's tyre smoke and dust (240 sprites) and the helicopter's rotor
// wash (420) were one THREE.Sprite each: every live one cost a draw in the lit pass (a handbrake slide or a hover over
// dirt put 100 to 300 of them in a frame). Here each particle is a plain object the old code moves as it moved its
// sprite (position, scale, visible, material.opacity, material.color, userData), and update() copies them into the
// instanced attributes of one sprite drawn `count` times.
import * as THREE from 'three/webgpu';
import { instancedBufferAttribute, texture, uv, vec4 } from 'three/tsl';

export class SpriteCloud {
  constructor(scene, max, map, { renderOrder = 0 } = {}) {
    this.max = max;
    this.items = [];
    // ((V9) static usage, uploaded through needsUpdate while anything is live: as dynamic buffers three's WebGPU renderer
    // uploaded them every frame, with nothing to show too)
    this.offset = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
    this.size = new THREE.InstancedBufferAttribute(new Float32Array(max), 1);
    this.tint = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4);
    const mat = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false });
    const tint = instancedBufferAttribute(this.tint);
    const tex = texture(map, uv());
    mat.positionNode = instancedBufferAttribute(this.offset);
    mat.scaleNode = instancedBufferAttribute(this.size);
    mat.colorNode = vec4(tex.rgb.mul(tint.rgb), tex.a.mul(tint.a));
    this.sprite = new THREE.Sprite(mat);
    this.sprite.count = max;
    this.sprite.frustumCulled = false;
    this.sprite.renderOrder = renderOrder;
    scene.add(this.sprite);
  }

  /** A particle: what a THREE.Sprite offered the old code. */
  add(userData = {}, colour = 0xffffff) {
    const p = { position: new THREE.Vector3(), scale: new THREE.Vector3(1, 1, 1), visible: false, material: { opacity: 0, color: new THREE.Color(colour) }, userData };
    this.items.push(p);
    return p;
  }

  /** Copies the particles into the draw (hidden or spent ones at size 0); once a frame. */
  update() {
    const o = this.offset.array;
    const s = this.size.array;
    const t = this.tint.array;
    let live = 0;
    for (let i = 0; i < this.items.length; i++) {
      const p = this.items[i];
      const on = p.visible && p.material.opacity > 0.001;
      o[i * 3] = p.position.x;
      o[i * 3 + 1] = p.position.y;
      o[i * 3 + 2] = p.position.z;
      s[i] = on ? p.scale.x : 0;
      const c = p.material.color;
      t[i * 4] = c.r;
      t[i * 4 + 1] = c.g;
      t[i * 4 + 2] = c.b;
      t[i * 4 + 3] = on ? p.material.opacity : 0;
      if (on) live++;
    }
    this.sprite.visible = live > 0;
    if (live > 0 || this.live > 0) this.offset.needsUpdate = this.size.needsUpdate = this.tint.needsUpdate = true;
    this.live = live;
  }
}
