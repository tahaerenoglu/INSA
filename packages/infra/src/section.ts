/**
 * Tunnel cross-sections. Coordinates (x, y) are in the section plane looking
 * in the direction of increasing station: x to the right, y up, origin on the
 * alignment (profile grade line). Analytic templates use corresponding rings.
 * Explicit dimensioned lining polygons keep independent vertex counts and
 * are lofted with polygon-with-hole end caps in the same sweep engine.
 */
import { GeometryError } from "./alignment.js";

export type UV = [number, number];

export type Profile =
  | { shape: "circle"; radius: number; center_y: number; center_x?:number }
  | { shape: "horseshoe"; crown_radius: number; spring_y: number; wall_bottom_y: number; invert_depth: number }
  | { shape: "polygon"; points: UV[] };

export interface Layer { id?: string; name: string; thickness: number; material?: string; materialId?: string;
  /** Explicit outer boundary for dimensioned variable-thickness lining. Independent CCW polygon; no correspondence or radial approximation required. */
  outer_profile?: UV[];
}
/** Preserve legacy slot identities until an edit explicitly persists them. */
export const layerId = (section: SectionType, index: number) => section.layers[index].id ?? `legacy-${index}`;

export interface SectionType {
  designBasis?: {status:string;notes:string[];sources:{title:string;reference:string}[]};
  id: string;
  name: string;
  profile: Profile;          // clear (inner) line
  layers: Layer[];           // inside -> out (e.g. final lining, shotcrete)
  overbreak?: number;        // payment line beyond the excavation line, m
  bolts?: { per_round: number; spacing: number; length: number };
  ring_length?: number;      // TBM segment ring length, m
}

const segs = (radius: number, angle: number, tol: number) =>
  Math.max(2, Math.ceil(Math.abs(angle) / (2 * Math.acos(Math.max(-1, 1 - tol / Math.max(radius, tol))))));

export function signedArea(p: UV[]) {
  let a = 0;
  for (let i = 0; i < p.length; i++) { const [x0, y0] = p[i], [x1, y1] = p[(i + 1) % p.length]; a += x0 * y1 - x1 * y0; }
  return a / 2;
}
export const polyArea = (p: UV[]) => Math.abs(signedArea(p));

function offsetPolygon(pts: UV[], d: number): UV[] {   // outward by d (mitred)
  const n = pts.length, s = signedArea(pts) > 0 ? -1 : 1;  // outward = right of a CCW edge
  const lines = pts.map((a, i) => {
    const b = pts[(i + 1) % n];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L;
    const nx = -uy * s, ny = ux * s;
    return { p: [a[0] + nx * d, a[1] + ny * d] as UV, u: [ux, uy] as UV };
  });
  return lines.map((cur, i) => {
    const prev = lines[(i - 1 + n) % n];
    const den = prev.u[0] * cur.u[1] - prev.u[1] * cur.u[0];
    if (Math.abs(den) < 1e-12) return cur.p;
    const t = ((cur.p[0] - prev.p[0]) * cur.u[1] - (cur.p[1] - prev.p[1]) * cur.u[0]) / den;
    return [prev.p[0] + t * prev.u[0], prev.p[1] + t * prev.u[1]] as UV;
  });
}

/** Boundary at outward offset o from the clear line, as a CCW polygon in (x, y). */
export function boundary(p: Profile, o: number, maxOffset: number, tol = 0.0002): UV[] {
  if (p.shape === "circle") {
    if (p.radius <= 0) throw new GeometryError("Circle radius must be positive.");
    const n = segs(p.radius + maxOffset, 2 * Math.PI, tol);
    const r = p.radius + o;
    return Array.from({ length: n }, (_, i) => {
      const a = -Math.PI / 2 + (2 * Math.PI * i) / n;
      return [(p.center_x??0)+r * Math.cos(a), p.center_y + r * Math.sin(a)] as UV;
    });
  }
  if (p.shape === "horseshoe") {
    const { crown_radius: Rc, spring_y: ys, wall_bottom_y: yb, invert_depth: d } = p;
    if (Rc <= 0 || d < 0 || yb > ys) throw new GeometryError("Horseshoe: crown_radius > 0, invert_depth >= 0 and wall_bottom_y <= spring_y.");
    if (d > Rc) throw new GeometryError("Horseshoe: invert_depth cannot exceed crown_radius.");
    const nc = segs(Rc + maxOffset, Math.PI, tol);
    const pts: UV[] = [];
    // crown: from right springline (angle 0) to left springline (angle PI), CCW
    for (let i = 0; i <= nc; i++) { const a = (Math.PI * i) / nc; pts.push([(Rc + o) * Math.cos(a), ys + (Rc + o) * Math.sin(a)]); }
    if (d === 0) {                                             // flat invert
      pts.push([-(Rc + o), yb - o], [Rc + o, yb - o]);
    } else {
      const Ri = (Rc * Rc + d * d) / (2 * d), cy = yb - d + Ri;
      const spanAt = (off: number) => {
        const rr = Ri + off, xx = Rc + off, yy = cy - Math.sqrt(rr * rr - xx * xx);
        return { yw: yy, a0: Math.atan2(yy - cy, -xx), span: ((Math.atan2(yy - cy, xx) - Math.atan2(yy - cy, -xx)) + 2 * Math.PI) % (2 * Math.PI) };
      };
      const r = Ri + o;
      const { a0, span } = spanAt(o);                          // left wall bottom -> right wall bottom through the invert
      // vertex count must not depend on the offset (layer rings need corresponding vertices)
      const ni = segs(Ri + maxOffset, Math.max(spanAt(0).span, spanAt(maxOffset).span), tol);
      for (let i = 0; i <= ni; i++) { const a = a0 + (span * i) / ni; pts.push([r * Math.cos(a), cy + r * Math.sin(a)]); }
    }
    return pts;
  }
  if (p.points.length < 3) throw new GeometryError("Polygon section needs at least 3 points.");
  const base = signedArea(p.points) > 0 ? p.points : [...p.points].reverse();
  return o === 0 ? base : offsetPolygon(base, o);
}

/** All boundaries of a section type: clear line, each layer's outer line, excavation, payment line. */
export function boundaries(t: SectionType, tol = 0.0002) {
  const offs = [0];
  for (const l of t.layers) offs.push(offs[offs.length - 1] + l.thickness);
  const exc = offs[offs.length - 1];
  const pay = exc + (t.overbreak ?? 0);
  const explicit=t.layers.some(l=>l.outer_profile!==undefined);
  if(explicit&&(t.profile.shape!=='polygon'||signedArea(t.profile.points)<=0))throw new GeometryError('Explicit lining requires a CCW polygon clear profile.');
  const rings:UV[][]=[boundary(t.profile,0,pay,tol)];
  let custom=false;
  for(const [i,l]of t.layers.entries()){
    if(l.outer_profile){custom=true;const outer=l.outer_profile.map(p=>[...p] as UV);validateExplicitRing(rings.at(-1)!,outer);rings.push(outer);}
    else if(custom){const outer=offsetPolygon(rings.at(-1)!,l.thickness);validateExplicitRing(rings.at(-1)!,outer);rings.push(outer);}
    else rings.push(boundary(t.profile,offs[i+1],pay,tol));
  }
  const payment = custom?offsetPolygon(rings.at(-1)!,t.overbreak??0):boundary(t.profile,pay,pay,tol);
  const n = rings[0].length;
  if (!custom&&(rings.some((r) => r.length !== n) || payment.length !== n)) throw new GeometryError("Section boundaries lost vertex correspondence.");
  return { offsets: offs, rings, excavation: rings[rings.length - 1], payment };
}

/** Validate independently dimensioned nested boundaries before the existing annulus sweep. */
function validateExplicitRing(inner:UV[],outer:UV[]){
  const cross=(a:UV,b:UV,c:UV)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  if(inner.length<3||inner.length>2048||outer.length<3||outer.length>2048||outer.some(p=>p.length!==2||p.some(v=>!Number.isFinite(v)))||signedArea(outer)<=0)throw new GeometryError('Explicit outer profile needs finite CCW vertices (3–2048).');
  const hit=(a:UV,b:UV,c:UV,d:UV)=>cross(a,b,c)*cross(a,b,d)<-1e-16&&cross(c,d,a)*cross(c,d,b)<-1e-16;
  for(const ring of [inner,outer])for(let i=0;i<ring.length;i++){
    const j=(i+1)%ring.length;if(Math.hypot(ring[j][0]-ring[i][0],ring[j][1]-ring[i][1])<1e-10)throw new GeometryError('Explicit lining has an empty edge.');
    for(let k=i+1;k<ring.length;k++){const q=(k+1)%ring.length;if(k!==j&&q!==i&&hit(ring[i],ring[j],ring[k],ring[q]))throw new GeometryError('Explicit lining boundary self-intersects.');}
  }
  for(let i=0;i<inner.length;i++)for(let j=0;j<outer.length;j++)if(hit(inner[i],inner[(i+1)%inner.length],outer[j],outer[(j+1)%outer.length]))throw new GeometryError('Explicit lining boundaries intersect.');
  const contains=(p:UV)=>{let inside=false;for(let i=0,j=outer.length-1;i<outer.length;j=i++)if((outer[i][1]>p[1])!==(outer[j][1]>p[1])&&p[0]<(outer[j][0]-outer[i][0])*(p[1]-outer[i][1])/(outer[j][1]-outer[i][1])+outer[i][0])inside=!inside;return inside;};
  if(inner.some(p=>!contains(p)))throw new GeometryError('Explicit lining outer boundary must enclose its clear profile.');
  if(polyArea(outer)<=polyArea(inner))throw new GeometryError('Explicit lining outer area must exceed inner area.');
}

/** Exact areas for the analytic templates (for checks and reports). */
export function exactArea(p: Profile, o: number): number | null {
  if (p.shape === "circle") return Math.PI * (p.radius + o) ** 2;
  if (p.shape === "horseshoe") {
    const Rc = p.crown_radius + o;
    const crown = (Math.PI * Rc * Rc) / 2;
    if (p.invert_depth === 0) return crown + 2 * Rc * (p.spring_y - (p.wall_bottom_y - o));
    const Ri0 = (p.crown_radius ** 2 + p.invert_depth ** 2) / (2 * p.invert_depth);
    const cy = p.wall_bottom_y - p.invert_depth + Ri0, r = Ri0 + o;
    const yw = cy - Math.sqrt(r * r - Rc * Rc);
    const walls = 2 * Rc * (p.spring_y - yw);
    const half = Math.asin(Rc / r);
    const segment = (r * r / 2) * (2 * half - Math.sin(2 * half));
    return crown + walls + segment;
  }
  return null;
}
