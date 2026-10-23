import json, ifcopenshell, ifcopenshell.validate, ifcopenshell.geom, ifcopenshell.util.shape as us
import ifcopenshell.util.element as ue, logging
f = ifcopenshell.open("ornek-ofis.ifc")
print("schema:", f.schema, "| entities:", len(list(f)))
log = logging.getLogger("v"); log.setLevel(logging.ERROR)
h = ifcopenshell.validate.json_logger()
ifcopenshell.validate.validate(f, h)
print("schema validation issues:", len(h.statements))
for s in h.statements[:8]: print("  -", str(s.get("message"))[:160])
for cls in ("IfcBuildingStorey","IfcWall","IfcSlab","IfcColumn","IfcBeam","IfcOpeningElement","IfcDoor","IfcWindow","IfcGrid","IfcMaterialLayerSetUsage","IfcRelVoidsElement","IfcRelFillsElement","IfcPropertySet"):
    print(f"  {cls:28s} {len(f.by_type(cls))}")
st = ifcopenshell.geom.settings(); st.set("use-world-coords", True)
vol = {}
for el in f.by_type("IfcWall")+f.by_type("IfcSlab")+f.by_type("IfcColumn")+f.by_type("IfcBeam"):
    sh = ifcopenshell.geom.create_shape(st, el)
    v = us.get_volume(sh.geometry)
    storey = ue.get_container(el).Name
    vol.setdefault((el.is_a(), storey), 0); vol[(el.is_a(), storey)] += v
for k,v in sorted(vol.items()): print(f"  volume {k[0]:10s} {k[1]:10s} {v:9.4f} m3")
exp = json.load(open("expected.json"))
w0 = vol[("IfcWall","00 Zemin")]
print(f"wall net volume 00 Zemin: ifcopenshell {w0:.6f} vs kernel {exp['wall_net_volume_storey0']:.6f} -> diff {abs(w0-exp['wall_net_volume_storey0']):.2e}")
s0 = vol[("IfcSlab","01 Kat")]
print(f"slab volume 01 Kat:       ifcopenshell {s0:.6f} vs kernel {exp['slab_volume']:.6f} -> diff {abs(s0-exp['slab_volume']):.2e}")
# exterior layer really outside? check first wall: layer set usage sense & the layer-0 side
w = [x for x in f.by_type("IfcWall") if ue.get_container(x).Name=="00 Zemin"][0]
u = ue.get_material(w); print("wall", w.Tag, "usage:", u.LayerSetDirection, u.DirectionSense, round(u.OffsetFromReferenceLine,3), "| layer0:", u.ForLayerSet.MaterialLayers[0].Material.Name)
print("Turkish names roundtrip:", [s.Name for s in f.by_type("IfcBuildingStorey")], f.by_type("IfcMaterial")[2].Name)
print("pset:", ue.get_psets(w).get("Pset_WallCommon"), ue.get_psets(w).get("INSA_Identity"))
