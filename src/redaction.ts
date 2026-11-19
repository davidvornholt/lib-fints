import type { DataElement } from './dataElements/DataElement.js';
import { DataGroup } from './dataGroups/DataGroup.js';
import type { Segment } from './segment.js';
import { getSegmentDefinition } from './segments/registry.js';

const REDACTED = '***';

/**
 * Returns a copy of the segment in which every value of an element marked `sensitive()`,
 * such as the PIN and TAN in HNSHA, is replaced by `***`. Everything else, such as account
 * data, is kept. A segment with no registered definition is returned as it is.
 */
export function redactSegment<T extends Segment>(segment: T): T {
	const definition = getSegmentDefinition(segment.header.segId);

	if (!definition) {
		return segment;
	}

	return redactValues(segment, definition.getElementsForVersion(segment.header.version)) as T;
}

function redactValues(values: unknown, elements: DataElement[]): unknown {
	if (Array.isArray(values)) {
		if (elements.length === 1 && elements[0].maxCount > 1) {
			return values.map((value) => redactValue(elements[0], value));
		}
		return values.map((value, index) =>
			index < elements.length ? redactElementValue(elements[index], value) : value,
		);
	}

	if (values && typeof values === 'object') {
		const copy: Record<string, unknown> = { ...values };
		for (const element of elements) {
			if (element.name in copy) {
				copy[element.name] = redactElementValue(element, copy[element.name]);
			}
		}
		return copy;
	}

	return values;
}

function redactElementValue(element: DataElement, value: unknown): unknown {
	return element.maxCount > 1 && Array.isArray(value)
		? value.map((item) => redactValue(element, item))
		: redactValue(element, value);
}

function redactValue(element: DataElement, value: unknown): unknown {
	if (value === undefined || value === null || value === '') {
		return value;
	}

	if (element.isSensitive) {
		return REDACTED;
	}

	return element instanceof DataGroup ? redactValues(value, element.elements) : value;
}
