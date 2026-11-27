import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

export type FiscusMood = "idle" | "walk" | "think" | "success";

// Hand-built mesh interpretation of the user's lavender treasure-chest reference.
// Geometry and animation are local; no image/model hosting service is involved.
export default function FiscusModel({ mood = "idle", variant = "launcher" }: { mood?: FiscusMood; variant?: "launcher" | "hero" | "mini" }) {
  const host = useRef<HTMLSpanElement>(null);
  const currentMood = useRef(mood);
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => { currentMood.current = mood; }, [mood]);

  useEffect(() => {
    if (!host.current) return;
    const element: HTMLSpanElement = host.current;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" }); }
    catch { setUnavailable(true); return; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.28;
    renderer.domElement.setAttribute("aria-hidden", "true");
    element.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-2, 2, 2.2, -1.8, .1, 30);
    camera.position.set(3.1, 2.2, 8); camera.lookAt(0, .35, 0);
    scene.add(new THREE.HemisphereLight(0xffffff, 0xa298c6, 2.6));
    const key = new THREE.DirectionalLight(0xfff8ff, 3.5); key.position.set(-3, 5, 5); scene.add(key);
    const rim = new THREE.DirectionalLight(0xe6dcff, 2); rim.position.set(4, 3, -3); scene.add(rim);
    const materials: THREE.Material[] = [];
    const geometries: THREE.BufferGeometry[] = [];
    const material = (color: string, roughness = .42, metalness = 0) => {
      const result = new THREE.MeshStandardMaterial({ color, roughness, metalness }); materials.push(result); return result;
    };
    const purple = material("#a47cce");
    const lidPurple = material("#b395d8");
    const softPurple = material("#c9aeeb");
    const inside = material("#6d4097", .75);
    const dark = material("#382341", .5);
    const silver = material("#c9c2ce", .33, .18);
    const gold = material("#ffc34e", .29, .35);
    const blush = material("#c387c6", .7);
    const model = new THREE.Group(); model.scale.setScalar(1.12); scene.add(model);
    function mesh(geometry: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D, x = 0, y = 0, z = 0) {
      geometries.push(geometry); const result = new THREE.Mesh(geometry, mat); result.position.set(x, y, z); parent.add(result); return result;
    }
    const box = (w: number, h: number, d: number, radius: number, mat: THREE.Material, parent: THREE.Object3D, x = 0, y = 0, z = 0) => mesh(new RoundedBoxGeometry(w, h, d, 4, radius), mat, parent, x, y, z);
    const ball = (radius: number, mat: THREE.Material, parent: THREE.Object3D, x = 0, y = 0, z = 0) => mesh(new THREE.SphereGeometry(radius, 20, 14), mat, parent, x, y, z);
    const tube = (points: number[][], radius: number, mat: THREE.Material, parent: THREE.Object3D) => mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(p[0], p[1], p[2]))), 20, radius, 10, false), mat, parent);

    // Hollow chest: four soft walls, floor, and dark cavity, with a hinged lid.
    const shell = box(1.85, 1.08, 1.18, .23, purple, model);
    const walls = new THREE.Group(); model.add(walls);
    box(1.85, .23, 1.18, .10, purple, walls, 0, -.40, 0);
    box(1.85, 1.03, .28, .12, purple, walls, 0, 0, .48);
    box(1.85, 1.03, .22, .10, purple, walls, 0, 0, -.48);
    box(.26, 1.03, .9, .12, purple, walls, -.80, 0, 0);
    box(.26, 1.03, .9, .12, purple, walls, .80, 0, 0);
    box(1.4, .10, .75, .04, inside, walls, 0, -.23, 0);
    const hinge = new THREE.Group(); hinge.position.set(0, .54, -.53); model.add(hinge);
    box(1.96, .63, 1.27, .22, lidPurple, hinge, 0, .22, .53);
    box(1.56, .08, .88, .04, inside, hinge, 0, -.09, .53);
    box(.36, .16, .15, .06, silver, hinge, 0, .05, 1.19);

    // Rounded silver lock, a dark keyhole, eyes and a tiny smile.
    box(.35, .40, .17, .09, silver, model, 0, .39, .66);
    ball(.045, dark, model, 0, .43, .754).scale.z = .4;
    box(.045, .10, .018, .016, dark, model, 0, .36, .75);
    const eyes = [-.32, .32].map(x => mesh(new THREE.CapsuleGeometry(.056, .13, 5, 12), dark, model, x, .05, .636));
    tube([[-.10,-.13,.646], [0,-.18,.658], [.10,-.13,.646]], .024, dark, model);
    [-.46, .46].forEach(x => { const cheek = ball(.08, blush, model, x, -.12, .635); cheek.scale.set(1,.40,.12); });

    const leftArm = new THREE.Group(); leftArm.position.set(-.83, .15, .08); model.add(leftArm);
    tube([[0,0,0],[-.25,-.08,.06],[-.42,-.29,.16],[-.40,-.45,.24]], .115, softPurple, leftArm);
    ball(.115, softPurple, leftArm, -.40,-.45,.24);
    const rightArm = new THREE.Group(); rightArm.position.set(.83, .15, .08); model.add(rightArm);
    tube([[0,0,0],[.25,.01,.06],[.39,.23,.14],[.42,.39,.16]], .115, softPurple, rightArm);
    ball(.115, softPurple, rightArm, .42,.39,.16);
    const legs = [-.39, .39].map(x => {
      const leg = new THREE.Group(); leg.position.set(x, -.42, 0); model.add(leg);
      mesh(new THREE.CapsuleGeometry(.135, .25, 6, 14), softPurple, leg, 0, -.20, 0);
      box(.31, .20, .42, .09, softPurple, leg, 0, -.38, .08); return leg;
    });
    const treasure = new THREE.Group(); model.add(treasure);
    const coins = Array.from({ length: 4 }, (_, i) => {
      const coin = mesh(new THREE.CylinderGeometry(.18, .18, .07, 24), gold, treasure, (i-1.5)*.31, .65 + (i%2)*.35, .05);
      coin.rotation.x = Math.PI / 2; return coin;
    });
    const starShape = new THREE.Shape();
    for (let i=0;i<10;i++) { const a=Math.PI/2+i*Math.PI/5, r=i%2 ? .09 : .19; if (i===0) starShape.moveTo(Math.cos(a)*r,Math.sin(a)*r); else starShape.lineTo(Math.cos(a)*r,Math.sin(a)*r); }
    starShape.closePath();
    const stars = [-1,1].map(side => mesh(new THREE.ExtrudeGeometry(starShape,{depth:.055,bevelEnabled:true,bevelSegments:2,steps:1,bevelSize:.025,bevelThickness:.025}), gold, treasure, side*.98, 1.25, .20));
    treasure.visible = false;
    // Sculpted question mark, not a texture or external font.
    const question = new THREE.Group(); model.add(question); question.position.set(0,1.25,.12);
    tube([[-.14,.15,0],[-.12,.29,0],[.06,.32,0],[.17,.18,0],[.08,.05,0],[0,-.04,0]], .045,gold,question);
    ball(.05,gold,question,0,-.20,0); question.visible=false;

    let pointerX = 0, pointerY = 0, frame = 0, lastFrame = 0, elapsed = 0;
    let active = true;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    function onPointer(event: globalThis.PointerEvent) {
      const rect = element.getBoundingClientRect();
      pointerX = Math.max(-1,Math.min(1,(event.clientX-(rect.left+rect.width/2))/250));
      pointerY = Math.max(-1,Math.min(1,(event.clientY-(rect.top+rect.height/2))/250));
    }
    // Only the floating model follows the pointer; small avatars stay quiet.
    if (variant === "launcher") window.addEventListener("pointermove", onPointer, { passive: true });
    function resize() { const rect = element.getBoundingClientRect(); renderer.setSize(Math.max(1,rect.width),Math.max(1,rect.height),false); const aspect=rect.width/Math.max(1,rect.height); camera.left=-2*aspect; camera.right=2*aspect; camera.updateProjectionMatrix(); }
    const observer = new ResizeObserver(resize); observer.observe(element); resize();
    const intersection = new IntersectionObserver(entries => { active=entries[0]?.isIntersecting ?? false; }); intersection.observe(element);
    function render(now: number) {
      frame=requestAnimationFrame(render);
      if (document.hidden || !active || now-lastFrame < (variant === "mini" ? 100 : 33)) return;
      const delta=Math.min((now-lastFrame)/1000,.08); lastFrame=now;
      if (!reduced.matches) elapsed+=delta;
      const t=elapsed, state=currentMood.current, walking=state==="walk", thinking=state==="think", success=state==="success";
      const blend=1-Math.exp(-delta*8);
      const goalLid=success ? -1.2 : thinking ? -.025 : -.10;
      hinge.rotation.x+=(goalLid-hinge.rotation.x)*blend;
      model.position.y = reduced.matches ? 0 : Math.sin(t*(walking?10:2))*(walking?.06:.035);
      model.rotation.y += ((thinking ? -.17 : pointerX*.22) - model.rotation.y)*blend;
      model.rotation.z += ((thinking ? -.10 : Math.sin(t*1.2)*.025) - model.rotation.z)*blend;
      model.rotation.x += ((variant === "launcher" ? pointerY*.05 : 0)-model.rotation.x)*blend;
      rightArm.rotation.z = success ? .45+Math.sin(t*6)*.08 : thinking ? -1.55 : Math.sin(t*3)*.18;
      leftArm.rotation.z = success ? -.9 : thinking ? .6 : Math.sin(t*2)*.06;
      legs.forEach((leg,i)=>{ leg.rotation.x=walking ? Math.sin(t*10+i*Math.PI)*.65 : success ? Math.sin(t*5+i)*.20 : 0; });
      const blink=!reduced.matches && t%5 > 4.80 ? .15 : 1;
      eyes.forEach(eye=>{ eye.scale.y=blink; });
      question.visible=thinking; question.rotation.z=Math.sin(t*2)*.08;
      treasure.visible=success; shell.visible=!success; walls.visible=success;
      coins.forEach((coin,i)=>{ coin.position.y=.69+(i%2)*.32+Math.sin(t*3+i)*.12; coin.rotation.z=t*.7+i; });
      stars.forEach((star,i)=>{ star.rotation.z=Math.sin(t*2+i)*.20; });
      renderer.render(scene,camera);
    }
    frame=requestAnimationFrame(render);
    const contextLost = (event: Event) => { event.preventDefault(); setUnavailable(true); };
    renderer.domElement.addEventListener("webglcontextlost",contextLost);
    return () => {
      cancelAnimationFrame(frame); observer.disconnect(); intersection.disconnect();
      window.removeEventListener("pointermove",onPointer);
      renderer.domElement.removeEventListener("webglcontextlost",contextLost);
      geometries.forEach(geometry=>geometry.dispose()); materials.forEach(mat=>mat.dispose());
      renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove();
    };
  }, [variant]);

  return <span ref={host} aria-hidden="true" className={`fiscus-model fiscus-model-${variant}`}>
    {unavailable && <span className="fiscus-model-fallback"><span>••</span><small>⌣</small></span>}
  </span>;
}
