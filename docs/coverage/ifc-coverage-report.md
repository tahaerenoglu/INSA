# IFC coverage report (generated: do not edit)

Source: **IFC4X3_ADD2** (frozen official IFC4.3 release; secondary: IFC4) via the machine-readable schemas bundled with IfcOpenShell (buildingSMART IFC4X3_ADD2 and IFC4 (ADD2 TC1) EXPRESS schemas, as bundled with IfcOpenShell 0.9.0). IFC schemas (c) buildingSMART International Limited. This file holds derived metadata only.
Registry: 146 categories, 17 engines. Command: `npm run bim:coverage`.

## Physical product coverage (concrete IfcElement + IfcFeatureElement entities)
| metric | value |
|---|---|
| concrete physical products | 150 |
|   of which physical elements / features | 145 / 5 |
| mapped to an INSA category | 131 |
| authorable (working creation path + IFC export) | 130 |
| Level 1 | 99 |
| Level 2 | 29 |
| Level 3 | 2 |
| level VERIFIED by a generated contract test | 130 |
| **unmapped** | **19** |
| export capable | 130 |
| missing type support (mapped) | 3 |
| missing representation support (mapped) | 1 |
| missing test coverage (authorable, unverified) | 0 |

## Other schema families (not geometry engines; reported separately, never merged into one percentage)
| family | total | concrete |
|---|---|---|
| spatial_structure | 20 | 16 |
| positioning | 5 | 4 |
| annotation | 1 | 1 |
| port | 2 | 1 |
| type | 158 | 139 |
| relationship | 51 | 45 |
| group_system | 9 | 9 |
| process_control | 27 | 22 |
| analysis | 39 | 29 |
| physical_feature | 8 | 5 |

Relationships the IFC writer emits: not measured (45 concrete relationship entities; no typed export capability is declared for them yet). Process / control (27) and analysis (39) entities are **not** implemented authoring and are not counted as coverage.

## Unmapped concrete physical product classes, by schema group
### IfcBuiltElement (8)
IfcCourse, IfcEarthworksElement, IfcEarthworksFill, IfcKerb, IfcPavement, IfcRail, IfcReinforcedSoil, IfcTrackElement

### IfcFeatureElement (4)
IfcEarthworksCut, IfcProjectionElement, IfcSurfaceFeature, IfcVoidingFeature

### IfcGeotechnicalAssembly (3)
IfcBorehole, IfcGeomodel, IfcGeoslice

### IfcFlowSegment (2)
IfcConveyorSegment, IfcFlowSegment

### IfcFlowFitting (1)
IfcFlowFitting

### IfcGeotechnicalStratum (1)
IfcGeotechnicalStratum

## Mapped physical products
| IFC entity | categories | engine | level | verified | export |
|---|---|---|---|---|---|
| IfcActuator | electrical.actuator | point_component | 1 | yes | yes |
| IfcAirTerminal | mechanical.air_terminal | point_component | 1 | yes | yes |
| IfcAirTerminalBox | mechanical.air_terminal_box | point_component | 1 | yes | yes |
| IfcAirToAirHeatRecovery | mechanical.air_to_air_heat_recovery | point_component | 1 | yes | yes |
| IfcAlarm | electrical.alarm | point_component | 1 | yes | yes |
| IfcAudioVisualAppliance | electrical.audio_visual_appliance | point_component | 1 | yes | yes |
| IfcBeam | structure.framing | profile_member | 2 | yes | yes |
| IfcBearing | structure.bearing | point_component | 1 | yes | yes |
| IfcBoiler | mechanical.boiler | point_component | 1 | yes | yes |
| IfcBuildingElementPart | architecture.building_element_part | point_component | 1 | yes | yes |
| IfcBuildingElementProxy | architecture.generic_model, site.component | point_component | 1 | yes | yes |
| IfcBuiltElement | architecture.built_element | point_component | 1 | yes | yes |
| IfcBurner | mechanical.burner | point_component | 1 | yes | yes |
| IfcCableCarrierFitting | electrical.cable_carrier_fitting | mep_fitting | 2 | yes | yes |
| IfcCableCarrierSegment | electrical.cable_tray, electrical.conduit | mep_network | 2 | yes | yes |
| IfcCableFitting | electrical.cable_fitting | mep_fitting | 2 | yes | yes |
| IfcCableSegment | electrical.cable_segment | mep_network | 1 | yes | yes |
| IfcCaissonFoundation | structure.caisson_foundation | profile_member | 1 | yes | yes |
| IfcChiller | mechanical.chiller | point_component | 1 | yes | yes |
| IfcChimney | architecture.chimney | point_component | 1 | yes | yes |
| IfcCivilElement | site.civil_element | point_component | 1 | yes | yes |
| IfcCoil | mechanical.coil | point_component | 1 | yes | yes |
| IfcColumn | structure.column | profile_member | 2 | yes | yes |
| IfcCommunicationsAppliance | electrical.communications_appliance | point_component | 1 | yes | yes |
| IfcCompressor | mechanical.compressor | point_component | 1 | yes | yes |
| IfcCondenser | mechanical.condenser | point_component | 1 | yes | yes |
| IfcController | electrical.controller | point_component | 1 | yes | yes |
| IfcCooledBeam | mechanical.cooled_beam | point_component | 1 | yes | yes |
| IfcCoolingTower | mechanical.cooling_tower | point_component | 1 | yes | yes |
| IfcCovering | architecture.ceiling | boundary | 2 | yes | yes |
| IfcCurtainWall | architecture.curtain_wall | curtain_wall | 2 | yes | yes |
| IfcDamper | mechanical.damper | point_component | 1 | yes | yes |
| IfcDeepFoundation | structure.deep_foundation | profile_member | 1 | yes | yes |
| IfcDiscreteAccessory | structure.discrete_accessory | point_component | 1 | yes | yes |
| IfcDistributionBoard | electrical.distribution_board | point_component | 1 | yes | yes |
| IfcDistributionChamberElement | mechanical.distribution_chamber_element | point_component | 1 | yes | yes |
| IfcDistributionControlElement | electrical.distribution_control_element | point_component | 1 | yes | yes |
| IfcDistributionElement | mechanical.distribution_element | point_component | 1 | yes | yes |
| IfcDistributionFlowElement | mechanical.distribution_flow_element | point_component | 1 | yes | yes |
| IfcDoor | architecture.door | hosted_component | 2 | yes | yes |
| IfcDuctFitting | mechanical.duct_fitting | mep_fitting | 2 | yes | yes |
| IfcDuctSegment | mechanical.duct, mechanical.flexible_duct | mep_network | 2 | yes | yes |
| IfcDuctSilencer | mechanical.duct_silencer | point_component | 1 | yes | yes |
| IfcElectricAppliance | electrical.electric_appliance | point_component | 1 | yes | yes |
| IfcElectricDistributionBoard | electrical.electric_distribution_board | point_component | 1 | yes | yes |
| IfcElectricFlowStorageDevice | electrical.electric_flow_storage_device | point_component | 1 | yes | yes |
| IfcElectricFlowTreatmentDevice | electrical.electric_flow_treatment_device | point_component | 1 | yes | yes |
| IfcElectricGenerator | electrical.electric_generator | point_component | 1 | yes | yes |
| IfcElectricMotor | electrical.electric_motor | point_component | 1 | yes | yes |
| IfcElectricTimeControl | electrical.electric_time_control | point_component | 1 | yes | yes |
| IfcElementAssembly | generic.element_assembly | assembly | 2 | yes | yes |
| IfcEnergyConversionDevice | mechanical.energy_conversion_device | point_component | 1 | yes | yes |
| IfcEngine | mechanical.engine | point_component | 1 | yes | yes |
| IfcEvaporativeCooler | mechanical.evaporative_cooler | point_component | 1 | yes | yes |
| IfcEvaporator | mechanical.evaporator | point_component | 1 | yes | yes |
| IfcFan | mechanical.fan | point_component | 1 | yes | yes |
| IfcFastener | structure.fastener | point_component | 1 | yes | yes |
| IfcFilter | mechanical.filter | point_component | 1 | yes | yes |
| IfcFireSuppressionTerminal | fire.fire_suppression_terminal | point_component | 1 | yes | yes |
| IfcFlowController | mechanical.flow_controller | point_component | 1 | yes | yes |
| IfcFlowInstrument | mechanical.flow_instrument | point_component | 1 | yes | yes |
| IfcFlowMeter | mechanical.flow_meter | point_component | 1 | yes | yes |
| IfcFlowMovingDevice | mechanical.flow_moving_device | point_component | 1 | yes | yes |
| IfcFlowStorageDevice | mechanical.flow_storage_device | point_component | 1 | yes | yes |
| IfcFlowTerminal | mechanical.flow_terminal | point_component | 1 | yes | yes |
| IfcFlowTreatmentDevice | mechanical.flow_treatment_device | point_component | 1 | yes | yes |
| IfcFooting | structure.footing | boundary | 2 | yes | yes |
| IfcFurnishingElement | architecture.furnishing_element | point_component | 1 | yes | yes |
| IfcFurniture | architecture.furniture | point_component | 1 | yes | yes |
| IfcGeographicElement | site.geographic_element | point_component | 1 | yes | yes |
| IfcHeatExchanger | mechanical.heat_exchanger | point_component | 1 | yes | yes |
| IfcHumidifier | mechanical.humidifier | point_component | 1 | yes | yes |
| IfcImpactProtectionDevice | structure.impact_protection_device | point_component | 1 | yes | yes |
| IfcInterceptor | plumbing.interceptor | point_component | 1 | yes | yes |
| IfcJunctionBox | electrical.junction_box | point_component | 1 | yes | yes |
| IfcLamp | electrical.lamp | point_component | 1 | yes | yes |
| IfcLightFixture | electrical.lighting_fixture | point_component | 1 | yes | yes |
| IfcLiquidTerminal | mechanical.liquid_terminal | point_component | 1 | yes | yes |
| IfcMechanicalFastener | structure.mechanical_fastener | point_component | 1 | yes | yes |
| IfcMedicalDevice | plumbing.medical_device | point_component | 1 | yes | yes |
| IfcMember | structure.brace | profile_member | 2 | yes | yes |
| IfcMobileTelecommunicationsAppliance | mechanical.mobile_telecommunications_appliance | point_component | 1 | yes | yes |
| IfcMooringDevice | site.mooring_device | point_component | 1 | yes | yes |
| IfcMotorConnection | electrical.motor_connection | point_component | 1 | yes | yes |
| IfcNavigationElement | site.navigation_element | point_component | 1 | yes | yes |
| IfcOpeningElement | architecture.opening | void | 0 | no | no |
| IfcOutlet | electrical.outlet | point_component | 1 | yes | yes |
| IfcPile | structure.pile | profile_member | 2 | yes | yes |
| IfcPipeFitting | plumbing.pipe_fitting | mep_fitting | 2 | yes | yes |
| IfcPipeSegment | plumbing.flexible_pipe, plumbing.pipe | mep_network | 2 | yes | yes |
| IfcPlate | structure.plate | boundary | 2 | yes | yes |
| IfcProtectiveDevice | electrical.protective_device | point_component | 1 | yes | yes |
| IfcProtectiveDeviceTrippingUnit | electrical.protective_device_tripping_unit | point_component | 1 | yes | yes |
| IfcPump | plumbing.pump | point_component | 1 | yes | yes |
| IfcRailing | architecture.railing | path | 2 | yes | yes |
| IfcRamp | architecture.ramp_assembly | assembly | 2 | yes | yes |
| IfcRampFlight | architecture.ramp_flight | ramp_flight | 2 | yes | yes |
| IfcReinforcingBar | structure.rebar_set | reinforcement | 2 | yes | yes |
| IfcReinforcingMesh | structure.rebar_mesh | reinforcement | 2 | yes | yes |
| IfcRoof | architecture.pitched_roof, architecture.roof | pitched_roof, boundary | 2 | yes | yes |
| IfcSanitaryTerminal | plumbing.fixture | point_component | 1 | yes | yes |
| IfcSensor | electrical.sensor | point_component | 1 | yes | yes |
| IfcShadingDevice | architecture.shading_device | point_component | 1 | yes | yes |
| IfcSign | architecture.sign | point_component | 1 | yes | yes |
| IfcSignal | mechanical.signal | point_component | 1 | yes | yes |
| IfcSlab | architecture.floor, architecture.landing, structure.foundation_slab, structure.slab | boundary | 2 | yes | yes |
| IfcSolarDevice | electrical.solar_device | point_component | 1 | yes | yes |
| IfcSpaceHeater | mechanical.space_heater | point_component | 1 | yes | yes |
| IfcStackTerminal | plumbing.stack_terminal | point_component | 1 | yes | yes |
| IfcStair | architecture.stair, architecture.stair_assembly | stair, assembly | 2 | yes | yes |
| IfcStairFlight | architecture.stair_flight | stair | 2 | yes | yes |
| IfcSwitchingDevice | electrical.switching_device | point_component | 1 | yes | yes |
| IfcSystemFurnitureElement | architecture.system_furniture_element | point_component | 1 | yes | yes |
| IfcTank | plumbing.tank | point_component | 1 | yes | yes |
| IfcTendon | structure.tendon | reinforcement | 2 | yes | yes |
| IfcTendonAnchor | structure.tendon_anchor | point_component | 1 | yes | yes |
| IfcTendonConduit | structure.tendon_conduit | reinforcement | 2 | yes | yes |
| IfcTransformer | electrical.transformer | point_component | 1 | yes | yes |
| IfcTransportElement | architecture.transport_element | point_component | 1 | yes | yes |
| IfcTubeBundle | mechanical.tube_bundle | point_component | 1 | yes | yes |
| IfcUnitaryControlElement | electrical.unitary_control_element | point_component | 1 | yes | yes |
| IfcUnitaryEquipment | mechanical.unitary_equipment | point_component | 1 | yes | yes |
| IfcValve | plumbing.valve | point_component | 1 | yes | yes |
| IfcVehicle | site.vehicle | point_component | 1 | yes | yes |
| IfcVibrationDamper | structure.vibration_damper | point_component | 1 | yes | yes |
| IfcVibrationIsolator | structure.vibration_isolator | point_component | 1 | yes | yes |
| IfcVirtualElement | architecture.virtual_element | point_component | 1 | yes | yes |
| IfcWall | architecture.wall, structure.shear_wall | wall | 3 | yes | yes |
| IfcWallStandardCase | architecture.wall_standard_case | wall | 3 | yes | yes |
| IfcWasteTerminal | plumbing.waste_terminal | point_component | 1 | yes | yes |
| IfcWindow | architecture.window | hosted_component | 2 | yes | yes |


## Per-category evidence (registry declarations + strict contract results)
| category | IFC entity | engine | level | cap | IFC export declared / verified | limitations |
|---|---|---|---|---|---|---|
| architecture.building_element_part | IfcBuildingElementPart | point_component | 1 | - | central / yes | generic family box geometry: no category-specific parametric geometry |
| architecture.built_element | IfcBuiltElement | point_component | 1 | - | central / yes | generic family box geometry: no category-specific parametric geometry |
| architecture.casework | - | point_component | 0 | - | central / no | generic family box geometry: no category-specific parametric geometry; declares no IFC class (exported generically) |
| architecture.ceiling | IfcCovering | boundary | 2 | - | central / yes | - |
| architecture.chimney | IfcChimney | point_component | 1 | - | central / yes | generic family box geometry: no category-specific parametric geometry |
| architecture.curtain_wall | IfcCurtainWall | curtain_wall | 2 | - | writer / yes | no per-panel overrides (doors, louvres, spandrels), no curved axes, no corner mullions, no anchors / brackets or glazing build-up |
| architecture.door | IfcDoor | hosted_component | 2 | - | central / yes | - |
| architecture.floor | IfcSlab | boundary | 2 | - | central / yes | - |
| architecture.furnishing_element | IfcFurnishingElement | point_component | 1 | - | central / yes | generic family box geometry: no category-specific parametric geometry |
| architecture.furniture | IfcFurniture | point_component | 1 | - | central / yes | generic family box geometry: no category-specific parametric geometry |
| architecture.generic_model | IfcBuildingElementProxy | point_component | 1 | - | central / yes | generic family box geometry: no category-specific parametric geometry |
| architecture.landing | IfcSlab | boundary | 2 | - | central / yes | its type is a layered slab type (written as an IfcSlabType FLOOR); the landing is told apart by its PredefinedType only |
| architecture.opening | IfcOpeningElement | void | 0 | - | central / no | IFC export not verified by the strict contract |
| architecture.pitched_roof | IfcRoof | pitched_roof | 2 | - | writer / yes | gable and hip forms on rectangular footprints only; no valleys, L / T / general footprints, roof openings, dormers or gambrel / mansard forms; neighbouring plane slabs overlap at ridges and hips (volume_gross sums the planes); the roof type's layers are not associated with the plane parts |
| architecture.railing | IfcRailing | path | 2 | - | central / yes | - |
| architecture.ramp_assembly | IfcRamp | assembly | 2 | - | writer / yes | - |
| architecture.ramp_flight | IfcRampFlight | ramp_flight | 2 | - | writer / yes | - |
| architecture.roof | IfcRoof | boundary | 2 | - | central / yes | - |
| architecture.room | IfcSpace | spatial | 2 | - | central / yes | - |
| architecture.shading_device | IfcShadingDevice | point_component | 1 | - | central / yes | generic family box geometry: no category-specific parametric geometry |
| architecture.sign | IfcSign | point_component | 1 | - | central / yes | generic family box geometry: no category-specific parametric geometry |
| architecture.stair | IfcStair | stair | 2 | - | central / yes | - |
| architecture.stair_assembly | IfcStair | assembly | 2 | - | writer / yes | - |
| architecture.stair_flight | IfcStairFlight | stair | 2 | - | central / yes | - |
| architecture.system_furniture_element | IfcSystemFurnitureElement | point_component | 1 | - | central / yes | generic family box geometry: no category-specific parametric geometry |
| architecture.transport_element | IfcTransportElement | point_component | 1 | - | central / yes | generic family box geometry: no category-specific parametric geometry |
| architecture.virtual_element | IfcVirtualElement | point_component | 1 | - | central / yes | generic family box geometry: no category-specific parametric geometry |
| architecture.wall | IfcWall | wall | 3 | - | central / yes | - |
| architecture.wall_standard_case | IfcWallStandardCase | wall | 3 | - | central / yes | IfcWallStandardCase is deprecated in IFC4.3 (kept for IFC4 interchange); it behaves exactly as architecture.wall |
| architecture.window | IfcWindow | hosted_component | 2 | - | central / yes | - |
| structure.bearing | IfcBearing | point_component | 1 | - | central / yes | generic family box geometry: no category-specific parametric geometry |
| structure.brace | IfcMember | profile_member | 2 | - | central / yes | - |
| structure.caisson_foundation | IfcCaissonFoundation | profile_member | 1 | 1 | central / yes | generic prismatic section along a downward axis: no caisson-specific parameters (chamber, skirt, bell) |
| structure.column | IfcColumn | profile_member | 2 | - | central / yes | - |
| structure.deep_foundation | IfcDeepFoundation | profile_member | 1 | 1 | central / yes | generic prismatic section along a downward axis: no foundation-specific parameters (shaft / base / socket), no capacity or soil interaction |
| structure.discrete_accessory | IfcDiscreteAccessory | point_component | 1 | - | central / yes | generic family box geometry: no category-specific parametric geometry |
| structure.fastener | IfcFastener | point_component | 1 | - | central / yes | generic family box geometry: no category-specific parametric geometry |
| structure.footing | IfcFooting | boundary | 2 | - | central / yes | - |
| structure.foundation_slab | IfcSlab | boundary | 2 | - | central / yes | - |
| structure.framing | IfcBeam | profile_member | 2 | - | central / yes | - |
| structure.impact_protection_device | IfcImpactProtectionDevice | point_component | 1 | - | central / yes | generic family box geometry: no category-specific parametric geometry |
| structure.mechanical_fastener | IfcMechanicalFastener | point_component | 1 | - | central / yes | generic family box geometry: no category-specific parametric geometry |
| structure.pile | IfcPile | profile_member | 2 | - | central / yes | - |
| structure.plate | IfcPlate | boundary | 2 | - | central / yes | - |
| structure.rebar_mesh | IfcReinforcingMesh | reinforcement | 2 | - | writer / yes | - |
| structure.rebar_set | IfcReinforcingBar | reinforcement | 2 | - | writer / yes | - |
| structure.shear_wall | IfcWall | wall | 3 | - | central / yes | - |
| structure.slab | IfcSlab | boundary | 2 | - | central / yes | - |
| structure.tendon | IfcTendon | reinforcement | 2 | - | writer / yes | - |
| structure.tendon_anchor | IfcTendonAnchor | point_component | 1 | - | central / yes | generic family box geometry: no category-specific parametric geometry |
| structure.tendon_conduit | IfcTendonConduit | reinforcement | 2 | - | writer / yes | - |
| structure.vibration_damper | IfcVibrationDamper | point_component | 1 | - | central / yes | generic family box geometry: no category-specific parametric geometry |
| structure.vibration_isolator | IfcVibrationIsolator | point_component | 1 | - | central / yes | generic family box geometry: no category-specific parametric geometry |
| mechanical.air_terminal | IfcAirTerminal | point_component | 1 | - | central / yes | generic family box geometry: no category-specific parametric geometry |
| mechanical.air_terminal_box | IfcAirTerminalBox | point_component | 1 | - | central / yes | generic family box geometry: no category-specific parametric geometry |
| mechanical.air_to_air_heat_recovery | IfcAirToAirHeatRecovery | point_component | 1 | - | central / yes | generic family box geometry: no category-specific parametric geometry |
| mechanical.boiler | IfcBoiler | point_component | 1 | - | central / yes | generic family box geometry: no category-specific parametric geometry |
| mechanical.burner | IfcBurner | point_component | 1 | - | central / yes | generic family box geometry: no category-specific parametric geometry |
| mechanical.chiller | IfcChiller | point_component | 1 | - | central / yes | generic family box geometry: no category-specific parametric geometry |
| mechanical.coil | IfcCoil | point_component | 1 | - | central / yes | generic family box geometry: no category-specific parametric geometry |
| mechanical.compressor | IfcCompressor | point_component | 1 | - | central / yes | generic family box geometry: no category-specific parametric geometry |
| mechanical.condenser | IfcCondenser | point_component | 1 | - | central / yes | generic family box geometry: no category-specific parametric geometry |
| mechanical.cooled_beam | IfcCooledBeam | point_component | 1 | - | central / yes | generic family box geometry: no category-specific parametric geometry |
| mechanical.cooling_tower | IfcCoolingTower | point_component | 1 | - | central / yes | generic family box geometry: no category-specific parametric geometry |
| mechanical.damper | IfcDamper | point_component | 1 | - | central / yes | generic family box geometry: no category-specific parametric geometry |
| mechanical.distribution_chamber_element | IfcDistributionChamberElement | point_component | 1 | - | central / yes | generic family box geometry: no category-specific parametric geometry |
| mechanical.distribution_element | IfcDistributionElement | point_component | 1 | - | central / yes | generic family box geometry: no category-specific parametric geometry |
| mechanical.distribution_flow_element | IfcDistributionFlowElement | point_component | 1 | - | central / yes | generic family box geometry: no category-specific parametric geometry |
| mechanical.duct | IfcDuctSegment | mep_network | 2 | - | central / yes | - |
| mechanical.duct_fitting | IfcDuctFitting | mep_fitting | 2 | - | writer / yes | - |
| mechanical.duct_silencer | IfcDuctSilencer | point_component | 1 | - | central / yes | generic family box geometry: no category-specific parametric geometry |
| mechanical.energy_conversion_device | IfcEnergyConversionDevice | point_component | 1 | - | central / yes | generic family box geometry: no category-specific parametric geometry |
| mechanical.engine | IfcEngine | point_component | 1 | - | central / yes | generic family box geometry: no category-specific parametric geometry |
| mechanical.equipment | - | point_component | 0 | - | central / no | generic family box geometry: no category-specific parametric geometry; declares no IFC class (exported generically) |
| mechanical.evaporative_cooler | IfcEvaporativeCooler | point_component | 1 | - | central / yes | generic family box geometry: no category-specific parametric geometry |
| mechanical.evaporator | IfcEvaporator | point_component | 1 | - | central / yes | generic family box geometry: no category-specific parametric geometry |
| mechanical.fan | IfcFan | point_component | 1 | - | central / yes | generic family box geometry: no category-specific parametric geometry |
| mechanical.filter | IfcFilter | point_component | 1 | - | central / yes | generic family box geometry: no category-specific parametric geometry |
| mechanical.flexible_duct | IfcDuctSegment | mep_network | 1 | 1 | central / yes | flexibility is category semantics only: a polyline route, no minimum bend radius or compression |
| mechanical.flow_controller | IfcFlowController | point_component | 1 | - | central / yes | generic family box geometry: no category-specific parametric geometry |
| mechanical.flow_instrument | IfcFlowInstrument | point_component | 1 | - | central / yes | generic family box geometry: no category-specific parametric geometry |
| mechanical.flow_meter | IfcFlowMeter | point_component | 1 | - | central / yes | generic family box geometry: no category-specific parametric geometry |
| mechanical.flow_moving_device | IfcFlowMovingDevice | point_component | 1 | - | central / yes | generic family box geometry: no category-specific parametric geometry |
| mechanical.flow_storage_device | IfcFlowStorageDevice | point_component | 1 | - | central / yes | generic family box geometry: no category-specific parametric geometry |
| mechanical.flow_terminal | IfcFlowTerminal | point_component | 1 | - | central / yes | generic family box geometry: no category-specific parametric geometry |
| mechanical.flow_treatment_device | IfcFlowTreatmentDevice | point_component | 1 | - | central / yes | generic family box geometry: no category-specific parametric geometry |
| mechanical.heat_exchanger | IfcHeatExchanger | point_component | 1 | - | central / yes | generic family box geometry: no category-specific parametric geometry |
| mechanical.humidifier | IfcHumidifier | point_component | 1 | - | central / yes | generic family box geometry: no category-specific parametric geometry |
| mechanical.liquid_terminal | IfcLiquidTerminal | point_component | 1 | - | central / yes | generic family box geometry: no category-specific parametric geometry |
| mechanical.mobile_telecommunications_appliance | IfcMobileTelecommunicationsAppliance | point_component | 1 | - | central / yes | generic family box geometry: no category-specific parametric geometry |
| mechanical.signal | IfcSignal | point_component | 1 | - | central / yes | generic family box geometry: no category-specific parametric geometry |
| mechanical.space | IfcSpace | spatial | 2 | - | central / yes | - |
| mechanical.space_heater | IfcSpaceHeater | point_component | 1 | - | central / yes | generic family box geometry: no category-specific parametric geometry |
| mechanical.tube_bundle | IfcTubeBundle | point_component | 1 | - | central / yes | generic family box geometry: no category-specific parametric geometry |
| mechanical.unitary_equipment | IfcUnitaryEquipment | point_component | 1 | - | central / yes | generic family box geometry: no category-specific parametric geometry |
| electrical.actuator | IfcActuator | point_component | 1 | - | central / yes | generic family box geometry: no category-specific parametric geometry |
| electrical.alarm | IfcAlarm | point_component | 1 | - | central / yes | generic family box geometry: no category-specific parametric geometry |
| electrical.audio_visual_appliance | IfcAudioVisualAppliance | point_component | 1 | - | central / yes | generic family box geometry: no category-specific parametric geometry |
| electrical.cable_carrier_fitting | IfcCableCarrierFitting | mep_fitting | 2 | - | writer / yes | - |
| electrical.cable_fitting | IfcCableFitting | mep_fitting | 2 | - | writer / yes | - |
| electrical.cable_segment | IfcCableSegment | mep_network | 1 | 1 | central / yes | a plain route with a round section: no conductor / insulation / core data, no bend or tension limits |
| electrical.cable_tray | IfcCableCarrierSegment | mep_network | 2 | - | central / yes | - |
| electrical.communications_appliance | IfcCommunicationsAppliance | point_component | 1 | - | central / yes | generic family box geometry: no category-specific parametric geometry |
| electrical.conduit | IfcCableCarrierSegment | mep_network | 2 | - | central / yes | - |
| electrical.controller | IfcController | point_component | 1 | - | central / yes | generic family box geometry: no category-specific parametric geometry |
| electrical.distribution_board | IfcDistributionBoard | point_component | 1 | - | central / yes | generic family box geometry: no category-specific parametric geometry |
| electrical.distribution_control_element | IfcDistributionControlElement | point_component | 1 | - | central / yes | generic family box geometry: no category-specific parametric geometry |
| electrical.electric_appliance | IfcElectricAppliance | point_component | 1 | - | central / yes | generic family box geometry: no category-specific parametric geometry |
| electrical.electric_distribution_board | IfcElectricDistributionBoard | point_component | 1 | - | central / yes | generic family box geometry: no category-specific parametric geometry |
| electrical.electric_flow_storage_device | IfcElectricFlowStorageDevice | point_component | 1 | - | central / yes | generic family box geometry: no category-specific parametric geometry |
| electrical.electric_flow_treatment_device | IfcElectricFlowTreatmentDevice | point_component | 1 | - | central / yes | generic family box geometry: no category-specific parametric geometry |
| electrical.electric_generator | IfcElectricGenerator | point_component | 1 | - | central / yes | generic family box geometry: no category-specific parametric geometry |
| electrical.electric_motor | IfcElectricMotor | point_component | 1 | - | central / yes | generic family box geometry: no category-specific parametric geometry |
| electrical.electric_time_control | IfcElectricTimeControl | point_component | 1 | - | central / yes | generic family box geometry: no category-specific parametric geometry |
| electrical.equipment | - | point_component | 0 | - | central / no | generic family box geometry: no category-specific parametric geometry; declares no IFC class (exported generically) |
| electrical.junction_box | IfcJunctionBox | point_component | 1 | - | central / yes | generic family box geometry: no category-specific parametric geometry |
| electrical.lamp | IfcLamp | point_component | 1 | - | central / yes | generic family box geometry: no category-specific parametric geometry |
| electrical.lighting_fixture | IfcLightFixture | point_component | 1 | - | central / yes | generic family box geometry: no category-specific parametric geometry |
| electrical.motor_connection | IfcMotorConnection | point_component | 1 | - | central / yes | generic family box geometry: no category-specific parametric geometry |
| electrical.outlet | IfcOutlet | point_component | 1 | - | central / yes | generic family box geometry: no category-specific parametric geometry |
| electrical.protective_device | IfcProtectiveDevice | point_component | 1 | - | central / yes | generic family box geometry: no category-specific parametric geometry |
| electrical.protective_device_tripping_unit | IfcProtectiveDeviceTrippingUnit | point_component | 1 | - | central / yes | generic family box geometry: no category-specific parametric geometry |
| electrical.sensor | IfcSensor | point_component | 1 | - | central / yes | generic family box geometry: no category-specific parametric geometry |
| electrical.solar_device | IfcSolarDevice | point_component | 1 | - | central / yes | generic family box geometry: no category-specific parametric geometry |
| electrical.switching_device | IfcSwitchingDevice | point_component | 1 | - | central / yes | generic family box geometry: no category-specific parametric geometry |
| electrical.transformer | IfcTransformer | point_component | 1 | - | central / yes | generic family box geometry: no category-specific parametric geometry |
| electrical.unitary_control_element | IfcUnitaryControlElement | point_component | 1 | - | central / yes | generic family box geometry: no category-specific parametric geometry |
| plumbing.fixture | IfcSanitaryTerminal | point_component | 1 | - | central / yes | generic family box geometry: no category-specific parametric geometry |
| plumbing.flexible_pipe | IfcPipeSegment | mep_network | 1 | 1 | central / yes | flexibility is category semantics only: a polyline route, no minimum bend radius |
| plumbing.interceptor | IfcInterceptor | point_component | 1 | - | central / yes | generic family box geometry: no category-specific parametric geometry |
| plumbing.medical_device | IfcMedicalDevice | point_component | 1 | - | central / yes | generic family box geometry: no category-specific parametric geometry |
| plumbing.pipe | IfcPipeSegment | mep_network | 2 | - | central / yes | - |
| plumbing.pipe_fitting | IfcPipeFitting | mep_fitting | 2 | - | writer / yes | - |
| plumbing.pump | IfcPump | point_component | 1 | - | central / yes | generic family box geometry: no category-specific parametric geometry |
| plumbing.stack_terminal | IfcStackTerminal | point_component | 1 | - | central / yes | generic family box geometry: no category-specific parametric geometry |
| plumbing.tank | IfcTank | point_component | 1 | - | central / yes | generic family box geometry: no category-specific parametric geometry |
| plumbing.valve | IfcValve | point_component | 1 | - | central / yes | generic family box geometry: no category-specific parametric geometry |
| plumbing.waste_terminal | IfcWasteTerminal | point_component | 1 | - | central / yes | generic family box geometry: no category-specific parametric geometry |
| fire.fire_suppression_terminal | IfcFireSuppressionTerminal | point_component | 1 | - | central / yes | generic family box geometry: no category-specific parametric geometry |
| site.civil_element | IfcCivilElement | point_component | 1 | - | central / yes | generic family box geometry: no category-specific parametric geometry |
| site.component | IfcBuildingElementProxy | point_component | 1 | - | central / yes | generic family box geometry: no category-specific parametric geometry |
| site.geographic_element | IfcGeographicElement | point_component | 1 | - | central / yes | generic family box geometry: no category-specific parametric geometry |
| site.mooring_device | IfcMooringDevice | point_component | 1 | - | central / yes | generic family box geometry: no category-specific parametric geometry |
| site.navigation_element | IfcNavigationElement | point_component | 1 | - | central / yes | generic family box geometry: no category-specific parametric geometry |
| site.vehicle | IfcVehicle | point_component | 1 | - | central / yes | generic family box geometry: no category-specific parametric geometry |
| generic.element_assembly | IfcElementAssembly | assembly | 2 | - | writer / yes | - |
