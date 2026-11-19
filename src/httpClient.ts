import { type CustomerMessage, type CustomerOrderMessage, Message } from './message.js';
import { redactSegment } from './redaction.js';
import { encode } from './segment.js';

export class HttpClient {
	constructor(
		public url: string,
		public debug = false,
		public debugRaw = false,
	) {}

	async sendMessage(message: CustomerMessage): Promise<Message> {
		const encodedMessage = message.encode();
		const requestBuffer = Buffer.from(encodedMessage, 'latin1');

		if (this.debug) {
			console.log('Request Message:\n');

			if (this.debugRaw) {
				console.log(redactEncodedMessage(encodedMessage, message).split("'").join('\n'));
			} else {
				console.log(message.toString());
			}
		}

		const response = await fetch(this.url, {
			method: 'POST',
			headers: { 'Content-Type': 'text/plain' },
			body: requestBuffer.toString('base64'),
		});

		if (response.ok) {
			const responseBuffer = Buffer.from(await response.text(), 'base64');
			const responseText = responseBuffer.toString('latin1');

			try {
				const customerOrderMessage = message as CustomerOrderMessage;
				const responseMessage = Message.decode(
					responseText,
					customerOrderMessage.supportsPartedResponseSegments
						? customerOrderMessage.orderResponseSegId
						: undefined,
				);
				if (this.debug) {
					console.log('Response Message:\n');

					if (this.debugRaw) {
						console.log(responseText.split("'").join('\n'));
					} else {
						console.log(`Response Message:\n${responseMessage.toString(true)}\n`);
					}
				}
				return responseMessage;
			} catch (error) {
				console.error('Error decoding response message:', error);
				// The response holds account data, so print it only when the caller asked for debug output.
				if (this.debug) {
					console.error('Response Message Content:\n', responseText.split("'").join('\n'));
				}
				throw error;
			}
		} else {
			throw Error(`Request failed with status code ${response.status}: ${await response.text()}`);
		}
	}
}

/**
 * The encoded message contains each segment's encoding verbatim, inside the HNVSD envelope
 * too, so each segment with sensitive values, such as HNSHA with the PIN and TAN, is
 * replaced by the encoding of its redacted copy. The length fields still give the lengths of
 * the message that was sent.
 */
function redactEncodedMessage(encodedMessage: string, message: CustomerMessage): string {
	return message.segments.reduce((text, segment) => {
		const encoded = encode(segment);
		const redacted = encode(redactSegment(segment));
		return redacted === encoded ? text : text.replaceAll(encoded, () => redacted);
	}, encodedMessage);
}
