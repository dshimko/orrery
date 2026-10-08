// SPDX-License-Identifier: Apache-2.0
// Label styles from the reference prototype. Hosts may override the custom properties
// (--ls label scale, --alert, --warn, --info) on an ancestor.
export const LABEL_CSS = `
.orrery-view{position:relative;width:100%;height:100%;overflow:hidden}
.orrery-view canvas{display:block;width:100%;height:100%;touch-action:none}
.orrery-labels{position:absolute;inset:0;pointer-events:none;overflow:hidden}
.orrery-band{position:absolute;left:0;right:0;top:0;height:4px;pointer-events:none}
.orrery-lab{position:absolute;left:0;top:0;white-space:nowrap;color:#E1ECFA;font-size:calc(13px*var(--ls,1));text-shadow:0 0 3px #02040A,0 0 3px #02040A,0 0 7px #02040A;will-change:transform;transform:translate(-9999px,-9999px)}
.orrery-lab.zone{font:600 calc(21px*var(--ls,1)) "Barlow Condensed",Barlow,sans-serif;letter-spacing:.3px}
.orrery-lab.pad{font-weight:600;font-size:calc(14px*var(--ls,1));color:#F2D9C2}
.orrery-lab.planet{font-weight:600;font-size:calc(14px*var(--ls,1))}
.orrery-lab.tower{font-weight:600;font-size:calc(13px*var(--ls,1));color:#EAF2FF}
.orrery-lab small{display:block;font-weight:400;font-size:.86em;color:#A6B8D2}
.orrery-lab small.late{color:#FFC766}
.orrery-lab.flag{background:rgba(5,9,18,.92);border:1.5px solid var(--alert,#FF5C61);border-radius:3px;padding:3px 8px;font-weight:600;font-size:calc(13px*var(--ls,1));color:#FFE3E3}
.orrery-lab.flag.warn{border-color:var(--warn,#FFB020);color:#FFF0CF}
.orrery-lab.flag.info{border-color:var(--info,#6EA8FF);color:#DCE9FF}
`;
