#!/usr/bin/env python3
"""
Generates packages/bim/src/ifc-schema-data.ts from the official IFC4X3_ADD2 / IFC4 schemas (via IfcOpenShell) and packages/bim/data/ifc-inventory.json.
Per concrete physical product class: attribute template (name + optional flag, per schema), PredefinedType enumeration (per schema), whether a GENERIC
writer can produce it (every attribute beyond the standard product set is optional), and its IFC type entity. Also the schema-derived CATEGORY LIST for
the families that behave as typed point components (distribution equipment and terminals, controls, furnishing, transportation, geographic, civil,
virtual, element components): the rules below are the only hand-written part and are deliberately simple and visible.
Run:  python3 scripts/ifc-schema-data.py
"""
import json, os, re
import ifcopenshell.ifcopenshell_wrapper as w

HERE = os.path.dirname(__file__)
inv = json.load(open(os.path.join(HERE, "..", "packages", "bim", "data", "ifc-inventory.json")))
s43, s4 = w.schema_by_name("IFC4X3_ADD2"), w.schema_by_name("IFC4")
STD = {"GlobalId", "OwnerHistory", "Name", "Description", "ObjectType", "ObjectPlacement", "Representation", "Tag", "PredefinedType"}

def decl(s, n):
    try: return s.declaration_by_name(n)
    except Exception: return None
def attrs(s, n):
    d = decl(s, n)
    return None if d is None else [[a.name(), 1 if a.optional() else 0] for a in d.all_attributes()]
def enum_of(s, n):
    d = decl(s, n)
    if d is None: return None
    for a in d.all_attributes():
        if a.name() == "PredefinedType":
            t = a.type_of_attribute()
            while hasattr(t, "declared_type"): t = t.declared_type()
            if hasattr(t, "enumeration_items"): return list(t.enumeration_items())
    return None
def generic(a):
    return a is not None and all((n in STD) or opt for n, opt in a)

classes = {}
phys = [e for e in inv["entities"] if not e["abstract"] and e["family"] in ("physical_element", "physical_feature")]
for e in phys:
    n = e["name"]; a43, a4 = attrs(s43, n), attrs(s4, n)
    tn = n + "Type"
    classes[n] = {"in_ifc4": a4 is not None, "attrs": a43, "attrs4": a4, "predefined": enum_of(s43, n), "predefined4": enum_of(s4, n),
                  "generic": generic(a43) and (a4 is None or generic(a4)), "type_entity": tn if decl(s43, tn) is not None else None}

# ---- the schema-derived typed-point-component categories (rules are explicit)
def anc(e): return set(e["ancestors"]) | {e["name"]}
EXCLUDE_SUBTREES = {"IfcFlowSegment", "IfcFlowFitting", "IfcReinforcingElement", "IfcTendon", "IfcTendonAnchor", "IfcTendonConduit", "IfcGeotechnicalElement", "IfcBuiltElement", "IfcFeatureElement", "IfcDeepFoundation", "IfcElementAssembly", "IfcOpeningElement"}
INCLUDE_ROOTS = {"IfcDistributionFlowElement", "IfcDistributionControlElement", "IfcDistributionChamberElement", "IfcFurnishingElement", "IfcTransportationDevice", "IfcTransportElement", "IfcGeographicElement", "IfcCivilElement", "IfcVirtualElement", "IfcElementComponent", "IfcDistributionElement"}
# classes under an otherwise excluded subtree that ARE honestly a typed point component (a device / simple solid with a type and a PredefinedType)
FORCE_POINT = {"IfcTendonAnchor", "IfcJunctionBox", "IfcBuiltElement", "IfcBearing", "IfcChimney", "IfcShadingDevice", "IfcMooringDevice", "IfcNavigationElement"}
EXISTING = {"IfcFurniture", "IfcBuildingElementProxy", "IfcLightFixture", "IfcSanitaryTerminal"}   # already mapped by earlier phases
ELECTRIC = re.compile(r"^Ifc(Electric|Lamp|LightFixture|Outlet|SwitchingDevice|ProtectiveDevice|Transformer|MotorConnection|Generator|SolarDevice|JunctionBox|AudioVisual|Communications|Alarm|Sensor|Actuator|Controller|UnitaryControl|DistributionBoard|CableFitting|Battery|Meter|ProtectiveDeviceTrippingUnit)")
PLUMBING = re.compile(r"^Ifc(WasteTerminal|StackTerminal|FireSuppressionTerminal|Tank|Interceptor|Valve|Pump|MedicalDevice|WaterMeter|SanitaryTerminal)")
def discipline(e):
    n, a = e["name"], anc(e)
    if "IfcFlowSegment" in a: return "mechanical"
    if ELECTRIC.match(n) or ("IfcDistributionControlElement" in a and n != "IfcFlowInstrument"): return "electrical"
    if n == "IfcFireSuppressionTerminal": return "fire"
    if PLUMBING.match(n): return "plumbing"
    if "IfcFlowMovingDevice" in a and n == "IfcPump": return "plumbing"
    if "IfcFlowController" in a and n == "IfcValve": return "plumbing"
    if "IfcDistributionElement" in a: return "mechanical"
    if "IfcGeographicElement" in a or "IfcCivilElement" in a or n == "IfcVehicle": return "site"
    if n in ("IfcBearing", "IfcTendonAnchor"): return "structure"
    if n in ("IfcMooringDevice", "IfcNavigationElement"): return "site"
    if n in ("IfcFastener", "IfcMechanicalFastener", "IfcDiscreteAccessory", "IfcImpactProtectionDevice", "IfcVibrationIsolator", "IfcVibrationDamper"): return "structure"
    return "architecture"
def snake(n): return re.sub(r"(?<!^)(?=[A-Z])", "_", n[3:]).lower()
cats = []
for e in phys:
    n = e["name"]; a = anc(e)
    if n in EXISTING: continue
    if n not in FORCE_POINT and (not (a & INCLUDE_ROOTS) or (a & EXCLUDE_SUBTREES)): continue
    if not classes[n]["generic"]: continue
    d = discipline(e)
    cats.append({"id": f"{d}.{snake(n)}", "name": re.sub(r"(?<!^)(?=[A-Z])", " ", n[3:]), "discipline": d, "ifcClass": n,
                 "system": bool(a & {"IfcDistributionFlowElement", "IfcDistributionControlElement", "IfcDistributionChamberElement", "IfcDistributionElement"})})
# ---- spatial structure of infrastructure (IFC4.3 only): facilities and their parts, with the enumerations the schema defines
def enum_attr(sch, cls, attr):
    d = decl(sch, cls)
    if d is None: return None
    for a in d.all_attributes():
        if a.name() == attr:
            t = a.type_of_attribute()
            while hasattr(t, "declared_type"): t = t.declared_type()
            if hasattr(t, "enumeration_items"): return list(t.enumeration_items())
    return None
SPATIAL = {"facility": ["IfcFacility", "IfcRoad", "IfcRailway", "IfcBridge", "IfcMarineFacility"], "facility_part": ["IfcFacilityPartCommon", "IfcRoadPart", "IfcRailwayPart", "IfcBridgePart", "IfcMarinePart"]}
spatial = {}
for kind, names in SPATIAL.items():
    for n in names:
        a = attrs(s43, n); assert a is not None, n
        spatial[n] = {"kind": kind, "attrs": a, "predefined": enum_attr(s43, n, "PredefinedType"), "usage": enum_attr(s43, n, "UsageType"), "composition": enum_attr(s43, n, "CompositionType")}
cats.sort(key=lambda c: c["id"])
ids = [c["id"] for c in cats]; assert len(ids) == len(set(ids)), "category id clash"
j = lambda x: json.dumps(x, separators=(",", ":"))
out = ["// GENERATED by scripts/ifc-schema-data.py from the official IFC4X3_ADD2 / IFC4 schemas (IfcOpenShell). Do not edit.",
       "// (c) buildingSMART International Limited: derived metadata only (names, attribute order, enumeration items).",
       "export interface IfcClassData { in_ifc4: boolean; generic: boolean; attrs: [string, 0 | 1][]; attrs4: [string, 0 | 1][] | null; predefined: string[] | null; predefined4: string[] | null; type_entity: string | null }",
       f"export const IFC_CLASS_DATA: Readonly<Record<string, IfcClassData>> = {j(classes)};",
       "export interface SchemaCategory { id: string; name: string; discipline: string; ifcClass: string; system: boolean }",
       f"export const SCHEMA_EQUIPMENT_CATEGORIES: readonly SchemaCategory[] = {j(cats)};",
       "export interface SpatialClassData { kind: \"facility\" | \"facility_part\"; attrs: [string, 0 | 1][]; predefined: string[] | null; usage: string[] | null; composition: string[] }",
       f"export const IFC_SPATIAL_DATA: Readonly<Record<string, SpatialClassData>> = {j(spatial)};", ""]
open(os.path.join(HERE, "..", "packages", "bim", "src", "ifc-schema-data.ts"), "w").write("\n".join(out))
from collections import Counter
print("classes with templates:", len(classes), "| generic-writable:", sum(c["generic"] for c in classes.values()), "| schema categories:", len(cats))
print("by discipline:", dict(Counter(c["discipline"] for c in cats)))
print("IFC4X3-only categories:", sum(1 for c in cats if not classes[c["ifcClass"]]["in_ifc4"]))
print("non-generic (need a custom writer) among INCLUDE roots:", [e["name"] for e in phys if (anc(e) & INCLUDE_ROOTS) and not (anc(e) & EXCLUDE_SUBTREES) and e["name"] not in EXISTING and not classes[e["name"]]["generic"]])
