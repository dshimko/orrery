// SPDX-License-Identifier: Apache-2.0
// Minimal DOM stand-in so label code runs in Node tests (jsdom is not installed).

class FakeStyle {
  transformWrites = 0;
  color = '';
  private value = '';
  get transform(): string {
    return this.value;
  }
  set transform(next: string) {
    this.value = next;
    this.transformWrites += 1;
  }
}

export class FakeEl {
  style = new FakeStyle();
  className = '';
  textContent = '';
  textWrites = 0;
  children: FakeEl[] = [];
  removed = false;
  ownerDocument = { createElement: () => new FakeEl() };
  appendChild(child: FakeEl): void {
    this.children.push(child);
  }
  remove(): void {
    this.removed = true;
  }
}
