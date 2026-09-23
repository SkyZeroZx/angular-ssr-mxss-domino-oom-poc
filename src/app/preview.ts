import { Component, inject, REQUEST_CONTEXT } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { HARDCODED_PAYLOADS, PayloadCase } from './payload';

@Component({
  selector: 'app-preview',
  template: `<div id="preview" [innerHTML]="value"></div>`,
})
export class Preview {
  private readonly route = inject(ActivatedRoute);
  private readonly requestContext = inject(REQUEST_CONTEXT, { optional: true }) as
    | { payload?: unknown }
    | null;

  readonly value = (() => {
    // Real HTTP-body transport used by the strongest reproduction path.
    const contextualPayload = this.requestContext?.payload;
    if (typeof contextualPayload === 'string') return contextualPayload;

    // Exact transport mode. This is the preferred manual-reproduction path.
    const raw = this.route.snapshot.queryParamMap.get('p');
    if (raw !== null) return raw;

    // Local lab shortcut: URL chooses one already-built literal string.
    // No payload construction happens in the measured render.
    const selectedCase = this.route.snapshot.queryParamMap.get('case');
    if (selectedCase === 'candidate' || selectedCase === 'control') {
      return HARDCODED_PAYLOADS[selectedCase as PayloadCase];
    }

    return '<p>safe</p>';
  })();
}
