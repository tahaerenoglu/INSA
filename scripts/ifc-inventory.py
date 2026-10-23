#!/usr/bin/env python3
"""
Generates packages/bim/data/ifc-inventory.json from the machine-readable buildingSMART EXPRESS schemas bundled with IfcOpenShell:
  IFC4X3_ADD2 (the frozen official IFC4.3 release; normative baseline) and IFC4 (= IFC4 ADD2 TC1).
No entity is listed by hand: every name, abstract flag, supertype chain and PredefinedType enumeration is read from the schema.
Attribution: the IFC schemas are (c) buildingSMART International Limited (https://standards.buildingsmart.org/IFC/RELEASE/IFC4_3/); this file
carries derived metadata only (entity names, hierarchy, enumeration items), not the schema text.
Run:  python3 scripts/ifc-inventory.py
"""
import json, os, sys
import ifcopenshell, ifcopenshell.ifcopenshell_wrapper as w

PRIMARY, SECONDARY = "IFC4X3_ADD2", "IFC4"
out_path = os.path.join(os.path.dirname(__file__), "..", "packages", "bim", "data", "ifc-inventory.json")

def chain(e):
    names, s = [], e.supertype()
    while s is not None:
        names.append(s.name()); s = s.supertype()
    return names

def predefined(e):
    try:
        for a in e.all_attributes():
            if a.name() == "PredefinedType":
                t = a.type_of_attribute()
                while hasattr(t, "declared_type"):
                    t = t.declared_type()
                if hasattr(t, "enumeration_items"): return list(t.enumeration_items())
                if hasattr(t, "declared_type"): return list(t.declared_type().enumeration_items())
    except Exception:
        pass
    return None

def family(name, ch, abstract):
    s = set(ch) | {name}
    # order matters: the most specific semantic family first
    if "IfcTypeObject" in s: return "type"
    if "IfcRelationship" in s: return "relationship"
    if "IfcPort" in s: return "port"
    if "IfcElement" in s:
        if "IfcFeatureElement" in s: return "physical_feature"
        return "physical_element"
    if "IfcPositioningElement" in s: return "positioning"
    if "IfcSpatialElement" in s: return "spatial_structure"
    if "IfcAnnotation" in s: return "annotation"
    if "IfcStructuralItem" in s or "IfcStructuralActivity" in s or "IfcStructuralResultGroup" in s or "IfcStructuralAnalysisModel" in s or "IfcStructuralLoadGroup" in s or "IfcStructuralConnectionCondition" in s or name.startswith("IfcStructuralLoad") or name.startswith("IfcStructural"): return "analysis"
    if "IfcProcess" in s or "IfcControl" in s or "IfcResource" in s or "IfcWorkCalendar" in s or "IfcWorkTime" in s or name.startswith("IfcTask") or name.startswith("IfcEvent") or name.startswith("IfcProcedure"): return "process_control"
    if "IfcGroup" in s: return "group_system"
    if "IfcActor" in s or "IfcActorRole" in s or name in ("IfcPerson", "IfcOrganization", "IfcPersonAndOrganization", "IfcApplication", "IfcOwnerHistory"): return "actor_ownership"
    if "IfcProduct" in s or "IfcObject" in s: return "other_object"
    if "IfcPropertyDefinition" in s or "IfcPropertySetDefinition" in s: return "property_definition"
    if "IfcRoot" in s: return "other_rooted"
    if "IfcRepresentationItem" in s or "IfcGeometricRepresentationContext" in s or "IfcRepresentation" in s or "IfcProfileDef" in s or "IfcPlacement" in s or "IfcObjectPlacement" in s or name.startswith("IfcCurve") or name.startswith("IfcSurface"): return "resource_geometry"
    if "IfcMaterialDefinition" in s or name.startswith("IfcMaterial"): return "resource_material"
    if "IfcProperty" in s or "IfcPhysicalQuantity" in s or name.startswith("IfcQuantity") or name.startswith("IfcProperty"): return "resource_property"
    if name.startswith("IfcCost") or name.startswith("IfcAppliedValue") or name.startswith("IfcMonetary"): return "resource_cost"
    if name.startswith("IfcUnit") or "Unit" in name or name.startswith("IfcDimension") or name.startswith("IfcMeasure"): return "resource_unit"
    return "resource_other"

sch1, sch2 = w.schema_by_name(PRIMARY), w.schema_by_name(SECONDARY)
names2 = {e.name() for e in sch2.entities()}
ents = []
for e in sorted(sch1.entities(), key=lambda x: x.name()):
    n, ch, ab = e.name(), chain(e), bool(e.is_abstract())
    fam = family(n, ch, ab)
    ents.append({"name": n, "abstract": ab, "family": fam, "supertype": ch[0] if ch else None, "ancestors": ch,
                 "in_ifc4": n in names2, "predefined_type": predefined(e)})
# IFC4-only entities (removed / renamed by IFC4.3) are kept so that nothing present in IFC4 ADD2 TC1 is silently dropped
only4 = []
names1 = {e["name"] for e in ents}
for e in sorted(sch2.entities(), key=lambda x: x.name()):
    if e.name() not in names1:
        ch = chain(e)
        only4.append({"name": e.name(), "abstract": bool(e.is_abstract()), "family": family(e.name(), ch, bool(e.is_abstract())), "supertype": ch[0] if ch else None, "ancestors": ch, "predefined_type": predefined(e)})
doc = {"_meta": {"generator": "scripts/ifc-inventory.py", "source": "buildingSMART IFC4X3_ADD2 and IFC4 (ADD2 TC1) EXPRESS schemas, as bundled with IfcOpenShell " + ifcopenshell.version,
                 "normative_baseline": PRIMARY, "secondary": SECONDARY, "official_url": "https://standards.buildingsmart.org/IFC/RELEASE/IFC4_3/",
                 "attribution": "IFC schemas (c) buildingSMART International Limited. This file holds derived metadata only.",
                 "note": "The official web site was not reachable from the build sandbox; the machine-readable schema bundled with IfcOpenShell (generated from the official EXPRESS) is the source.",
                 "entity_count": len(ents), "ifc4_only_count": len(only4)},
       "entities": ents, "ifc4_only": only4}
os.makedirs(os.path.dirname(out_path), exist_ok=True)
json.dump(doc, open(out_path, "w"), indent=1, sort_keys=False)
from collections import Counter
c = Counter((x["family"], x["abstract"]) for x in ents)
print("IFC4X3_ADD2 entities:", len(ents), "| IFC4-only:", len(only4))
for (f, a), n in sorted(c.items()): print(f"  {f:22s} {'abstract' if a else 'concrete':9s} {n}")
