import {DomainError} from '@insa/core';
import {GeometryError,buildHorizontal,validateHorizontalElements,type Alignment3D} from './alignment.js';
import type {AlignmentDef} from './module.js';
/** Shared resource adapter; kept outside tool initialization to avoid a module/schema cycle. */
export function align3d(d:AlignmentDef):Alignment3D{try{return {h:d.elements?validateHorizontalElements(d.elements,d.start_station):buildHorizontal(d.points,d.start_station),v:d.pvis};}catch(e){if(e instanceof GeometryError)throw new DomainError(e.message);throw e;}}
