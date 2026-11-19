import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';
import { Language } from '../codes.js';
import { HttpClient } from '../httpClient.js';
import { CustomerMessage } from '../message.js';
import { HKIDN, type HKIDNSegment } from '../segments/HKIDN.js';
import { HKVVB, type HKVVBSegment } from '../segments/HKVVB.js';
import { HNSHA, type HNSHASegment } from '../segments/HNSHA.js';
import { registerSegments } from '../segments/registry.js';

registerSegments();

const pin = 'pin-4711';
const tan = 'tan-0815';
const accountText = 'synthetic-account-DE00123456780000000000';

const validResponse = `HNHBK:1:3+000000000108+300+0+1'HIRMG:2:2+0010::${accountText}'HNHBS:3:1+1'`;
const undecodableResponse = `HNHBK:1:3+000000000108+300+0+1'HIRMG:2:2+0010::${accountText}'HKIDN:3:2+280:12030000'HNHBS:4:1+1'`;

function signedMessage(): CustomerMessage {
	const hkidn: HKIDNSegment = {
		header: { segId: HKIDN.Id, segNr: 0, version: HKIDN.Version },
		bank: { country: 280, bankId: '12030000' },
		customerId: '9999999999',
		systemId: '0',
		systemIdRequired: 0,
	};
	const hkvvb: HKVVBSegment = {
		header: { segId: HKVVB.Id, segNr: 0, version: HKVVB.Version },
		bpdVersion: 0,
		updVersion: 0,
		dialogLanguage: Language.Default,
		productId: 'ABCDEF',
		productVersion: '1.0',
	};

	const message = new CustomerMessage('0', 1);
	message.addSegment(hkidn);
	message.addSegment(hkvvb);
	message.sign(280, '12030000', '12345678', pin, '0', 900, tan);
	return message;
}

function respondWith(text: string) {
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => new Response(Buffer.from(text, 'latin1').toString('base64'))),
	);
}

function printed(...spies: MockInstance[]): string {
	return spies
		.flatMap((spy) => spy.mock.calls)
		.flat()
		.map((value) => String(value))
		.join('\n');
}

describe('HttpClient logging', () => {
	let log: MockInstance;
	let error: MockInstance;

	beforeEach(() => {
		log = vi.spyOn(console, 'log').mockImplementation(() => {});
		error = vi.spyOn(console, 'error').mockImplementation(() => {});
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	it('redacts the PIN and TAN in the debug output of a request', async () => {
		respondWith(validResponse);

		const message = signedMessage();
		await new HttpClient('https://bank.example', true).sendMessage(message);

		const output = printed(log);
		expect(output).toContain('HNSHA');
		expect(output).toContain('pin: ***');
		expect(output).toContain('tan: ***');
		expect(output).not.toContain(pin);
		expect(output).not.toContain(tan);
		expect(message.findSegment<HNSHASegment>(HNSHA.Id)?.customSignature).toEqual({ pin, tan });
	});

	it('redacts the PIN and TAN in the raw debug output of a request', async () => {
		respondWith(validResponse);

		await new HttpClient('https://bank.example', true, true).sendMessage(signedMessage());

		const output = printed(log);
		expect(output).toContain('HNSHA:');
		expect(output).toContain('***:***');
		expect(output).not.toContain(pin);
		expect(output).not.toContain(tan);
	});

	it('still sends the PIN and TAN to the bank', async () => {
		respondWith(validResponse);

		await new HttpClient('https://bank.example', true).sendMessage(signedMessage());

		const body = vi.mocked(fetch).mock.calls[0][1]?.body as string;
		const sent = Buffer.from(body, 'base64').toString('latin1');
		expect(sent).toContain(`${pin}:${tan}`);
	});

	it('logs no message content for an undecodable response without debug', async () => {
		respondWith(undecodableResponse);

		await expect(
			new HttpClient('https://bank.example').sendMessage(signedMessage()),
		).rejects.toThrow();

		const output = printed(log, error);
		expect(output).toContain('Error decoding response message');
		expect(output).not.toContain(accountText);
	});

	it('logs the content of an undecodable response with debug', async () => {
		respondWith(undecodableResponse);

		await expect(
			new HttpClient('https://bank.example', true).sendMessage(signedMessage()),
		).rejects.toThrow();

		expect(printed(error)).toContain(accountText);
	});
});
