/** Bundled Glossa vectors. No remote assets or model-generated markup is parsed.
 * Interface glyphs follow a 24px, 1.8px-stroke outline grid. Provider marks: OpenAI / Simple Icons (CC0),
 * Claude official logo, xAI / Lobe Icons (MIT, copyright LobeHub). Trademarks belong to their owners.
 */
type Vector = readonly [string, Readonly<Record<string, string>>, readonly Vector[]];
const OUTLINE = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.8', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };
const path = (d: string, extra: Record<string, string> = {}): Vector => ['path', { d, ...extra }, []];
const circle = (cx: number, cy: number, r: number, extra: Record<string, string> = {}): Vector => ['circle', { cx: String(cx), cy: String(cy), r: String(r), ...extra }, []];
const rect = (x: number, y: number, width: number, height: number, rx: number, extra: Record<string, string> = {}): Vector =>
  ['rect', { x: String(x), y: String(y), width: String(width), height: String(height), rx: String(rx), ...extra }, []];
const outline = (...children: Vector[]): Vector => ['svg', OUTLINE, children];
const page = 'M14.5 2.5H6.5a2 2 0 0 0-2 2v15a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-12z';
const fold = 'M14 2.5v4a1.5 1.5 0 0 0 1.5 1.5h4';
const tray = 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4';
/** The Glossa brand mark (cloud and moon) and its haloed home-page variant, unchanged from the Obsidian edition. */
const BRAND = {"mark":["svg",{"viewBox":"98 38 154 154","fill":"none"},[["defs",{},[["linearGradient",{"id":"glossa-mark-grad","x1":"104","y1":"172","x2":"238","y2":"52","gradientUnits":"userSpaceOnUse"},[["stop",{"offset":"0","stop-color":"#10c8f4"},[]],["stop",{"offset":"0.48","stop-color":"#2f86ff"},[]],["stop",{"offset":"1","stop-color":"#654cf3"},[]]]]]],["g",{"stroke":"url(#glossa-mark-grad)","stroke-width":"6","stroke-linecap":"round","stroke-linejoin":"round"},[["path",{"d":"M120.2 131.7 C112.4 125.1 108.2 115.8 109.1 105.6 C110.4 91.1 121.7 80.6 136.2 79.9 C140.7 64.6 154.3 55.1 171.5 54.2 C178.1 53.9 184.1 54.9 189.8 57.1 M226.9 72.5 C235.1 77.6 239.8 86.3 239.2 96.2 C246.2 100.6 249.8 108.5 249 117 C247.9 130.3 236.8 140.4 222.7 140.4 C218.5 149.6 209.8 155.7 199.5 155.8 C190.5 156 182.8 151.9 178.1 145.3 C172.8 150.8 165.5 153.8 157.7 153.4 C150.7 153.1 144.7 150.6 139.9 146.3"},[]],["path",{"d":"M175.8 73.3 C160.9 79.1 151.1 94.2 153.4 110.6 C156.3 131.2 175.5 145.4 196.1 142.4 C205.7 141.1 214.1 136.2 220 129 C216.7 130.6 213.1 131.7 209.2 132.2 C189.2 135.1 170.8 121.2 168 101.3 C166.5 90.8 169.7 80.8 175.8 73.3Z"},[]],["circle",{"cx":"140.1","cy":"143.8","r":"15.9"},[]],["circle",{"cx":"118.8","cy":"168.3","r":"7.6"},[]],["path",{"d":"M208.9 52 C210.8 61.1 214.5 64.8 223.6 66.7 C214.5 68.6 210.8 72.3 208.9 81.4 C207 72.3 203.3 68.6 194.2 66.7 C203.3 64.8 207 61.1 208.9 52Z"},[]],["path",{"d":"M195.5 84.5 C197 91.1 199.7 93.9 206.2 95.4 C199.7 96.9 197 99.6 195.5 106.2 C194 99.6 191.3 96.9 184.7 95.4 C191.3 93.9 194 91.1 195.5 84.5Z"},[]]]]]],"orb":["svg",{"viewBox":"0 0 128 128","fill":"none"},[["defs",{},[["radialGradient",{"id":"g-orb-halo","cx":"50%","cy":"50%","r":"50%"},[["stop",{"offset":"0%","stop-color":"#654cf3","stop-opacity":"0.40"},[]],["stop",{"offset":"38%","stop-color":"#2f86ff","stop-opacity":"0.22"},[]],["stop",{"offset":"78%","stop-color":"#10c8f4","stop-opacity":"0.06"},[]],["stop",{"offset":"100%","stop-color":"#10c8f4","stop-opacity":"0"},[]]]],["linearGradient",{"id":"g-orb-mark-grad","x1":"20","y1":"108","x2":"108","y2":"20","gradientUnits":"userSpaceOnUse"},[["stop",{"offset":"0","stop-color":"#10c8f4"},[]],["stop",{"offset":"0.48","stop-color":"#2f86ff"},[]],["stop",{"offset":"1","stop-color":"#654cf3"},[]]]],["filter",{"id":"g-orb-soft","x":"-50%","y":"-50%","width":"200%","height":"200%"},[["feGaussianBlur",{"stdDeviation":"2.2"},[]]]]]],["g",{"class":"g-orb-halo-wrap"},[["circle",{"class":"g-orb-halo","cx":"64","cy":"64","r":"62","fill":"url(#g-orb-halo)","filter":"url(#g-orb-soft)"},[]]]],["g",{"class":"g-orb-mark-wrap"},[["g",{"class":"g-orb-mark","stroke":"url(#g-orb-mark-grad)","stroke-width":"11","stroke-linecap":"round","stroke-linejoin":"round","transform":"translate(64 64) scale(0.50) translate(-175 -115)"},[["path",{"d":"M120.2 131.7 C112.4 125.1 108.2 115.8 109.1 105.6 C110.4 91.1 121.7 80.6 136.2 79.9 C140.7 64.6 154.3 55.1 171.5 54.2 C178.1 53.9 184.1 54.9 189.8 57.1 M226.9 72.5 C235.1 77.6 239.8 86.3 239.2 96.2 C246.2 100.6 249.8 108.5 249 117 C247.9 130.3 236.8 140.4 222.7 140.4 C218.5 149.6 209.8 155.7 199.5 155.8 C190.5 156 182.8 151.9 178.1 145.3 C172.8 150.8 165.5 153.8 157.7 153.4 C150.7 153.1 144.7 150.6 139.9 146.3"},[]],["path",{"d":"M175.8 73.3 C160.9 79.1 151.1 94.2 153.4 110.6 C156.3 131.2 175.5 145.4 196.1 142.4 C205.7 141.1 214.1 136.2 220 129 C216.7 130.6 213.1 131.7 209.2 132.2 C189.2 135.1 170.8 121.2 168 101.3 C166.5 90.8 169.7 80.8 175.8 73.3Z"},[]],["circle",{"cx":"140.1","cy":"143.8","r":"15.9"},[]],["circle",{"cx":"118.8","cy":"168.3","r":"7.6"},[]],["path",{"d":"M208.9 52 C210.8 61.1 214.5 64.8 223.6 66.7 C214.5 68.6 210.8 72.3 208.9 81.4 C207 72.3 203.3 68.6 194.2 66.7 C203.3 64.8 207 61.1 208.9 52Z"},[]],["path",{"d":"M195.5 84.5 C197 91.1 199.7 93.9 206.2 95.4 C199.7 96.9 197 99.6 195.5 106.2 C194 99.6 191.3 96.9 184.7 95.4 C191.3 93.9 194 91.1 195.5 84.5Z"},[]]]]]]]]} as unknown as Record<'mark' | 'orb', Vector>;

const vectors: Record<string, Vector> = {
  mark: BRAND.mark,
  orb: BRAND.orb,
  plus: outline(path('M12 5v14'), path('M5 12h14')),
  x: outline(path('M18 6 6 18'), path('m6 6 12 12')),
  check: outline(path('M20 6 9 17l-5-5')),
  chevronDown: outline(path('m6 9 6 6 6-6')),
  chevronRight: outline(path('m9 6 6 6-6 6')),
  arrowLeft: outline(path('M19 12H5'), path('m12 19-7-7 7-7')),
  arrowUp: outline(path('M12 19V5'), path('m5 12 7-7 7 7')),
  stop: ['svg', { viewBox: '0 0 24 24', fill: 'currentColor' }, [rect(6, 6, 12, 12, 2.5)]],
  history: outline(path('M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8'), path('M3 3v5h5'), path('M12 7v5l3.5 2')),
  cog: outline(circle(12, 12, 3), path('M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z')),
  more: outline(circle(5, 12, .6, { fill: 'currentColor' }), circle(12, 12, .6, { fill: 'currentColor' }), circle(19, 12, .6, { fill: 'currentColor' })),
  search: outline(circle(11, 11, 7), path('m20 20-3.6-3.6')),
  window: outline(path('M20 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h6'), path('M15 3h6v6'), path('m21 3-9 9')),
  sidebar: outline(rect(3, 3, 18, 18, 2.5), path('M15 3v18')),
  file: outline(path(page), path(fold)),
  fileText: outline(path(page), path(fold), path('M8.5 13h7'), path('M8.5 17h5')),
  filePlus: outline(path(page), path(fold), path('M12 11v7'), path('M8.5 14.5h7')),
  quote: outline(path('M17 6H3'), path('M21 12H8'), path('M21 18H8'), path('M3 12v6')),
  gauge: outline(path('m12 14 4-4'), path('M3.34 19a10 10 0 1 1 17.32 0')),
  copy: outline(rect(8, 8, 13, 13, 2), path('M4 16a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2')),
  note: outline(path('M15.5 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8.5z'), path('M15 3v4a2 2 0 0 0 2 2h4'), path('M7.5 13h6'), path('M7.5 17h8')),
  retry: outline(path('M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8'), path('M3 3v5h5')),
  bookmark: outline(path('m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z')),
  folder: outline(path('M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2z')),
  pencil: outline(path('M21.17 6.81a1 1 0 0 0-3.99-3.99L3.84 16.17a2 2 0 0 0-.5.83l-1.32 4.35a.5.5 0 0 0 .62.62l4.35-1.32a2 2 0 0 0 .83-.5z'), path('m15 5 4 4')),
  trash: outline(path('M3 6h18'), path('M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6'), path('M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2')),
  download: outline(path(tray), path('m7 10 5 5 5-5'), path('M12 15V3')),
  upload: outline(path(tray), path('m17 8-5-5-5 5'), path('M12 3v12')),
  languages: outline(path('m5 8 6 6'), path('m4 14 6-6 2-3'), path('M2 5h12'), path('M7 2h1'), path('m22 22-5-10-5 10'), path('M14 18h6')),
  message: outline(path('M7.9 20A9 9 0 1 0 4 16.1L2 22z')),
  bulb: outline(path('M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5'), path('M9 18h6'), path('M10 22h4')),
  columns: outline(rect(3, 3, 18, 18, 2.5), path('M12 3v18')),
  summary: outline(path('M15 12H3'), path('M17 18H3'), path('M21 6H3')),
  at: outline(circle(12, 12, 4), path('M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8')),
  cloud: outline(path('M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9z')),
  terminal: outline(path('m4 17 6-6-6-6'), path('M12 19h8')),
  loader: outline(path('M21 12a9 9 0 1 1-6.22-8.56')),
  info: outline(circle(12, 12, 9.5), path('M12 16v-4'), path('M12 8h.01')),
  alert: outline(circle(12, 12, 9.5), path('M12 8v4'), path('M12 16h.01')),
  codex: ['svg', { viewBox: '0 0 24 24', fill: 'currentColor' }, [path('M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z')]],
  claude: ['svg', { viewBox: '-1 0 28 28' }, [path('M5.07306 17.7192L9.99106 14.9614L10.0721 14.7199L9.99106 14.5854H9.74786L8.92369 14.5352L6.11341 14.46L3.68143 14.3597L1.31701 14.2344L0.722529 14.109L0.168579 13.3694L0.222623 13.0059L0.722529 12.6675L1.43861 12.7301L3.0194 12.8429L5.39733 13.0059L7.11322 13.1062L9.66679 13.3694H10.0721L10.1262 13.2065L9.99106 13.1062L9.88297 13.0059L7.42397 11.3387L4.76231 9.58378L3.37068 8.56843L2.62758 8.05448L2.24927 7.57814L2.08714 6.52518L2.76269 5.77306L3.68143 5.83574L3.91112 5.89842L4.84338 6.61293L6.82949 8.15476L9.4236 10.0601L9.80191 10.3735L9.95424 10.2707L9.97755 10.198L9.80191 9.9097L8.39676 7.36504L6.89705 4.77024L6.2215 3.69221L6.04585 3.05291C5.97781 2.78463 5.93777 2.56267 5.93777 2.28826L6.70789 1.2353L7.14024 1.09741L8.18059 1.2353L8.61294 1.61136L9.26147 3.09052L10.3018 5.40954L11.9231 8.56843L12.396 9.50857L12.6527 10.3735L12.7473 10.6367H12.9094V10.4863L13.0445 8.70631L13.2877 6.52518L13.5309 3.71728L13.612 2.92756L14.0038 1.97488L14.7875 1.46093L15.3954 1.74925L15.8954 2.46376L15.8278 2.92756L15.5306 4.85799L14.9496 7.87899L14.5713 9.9097H14.7875L15.0442 9.64646L16.071 8.29265L17.7869 6.13659L18.5435 5.28419L19.4352 4.34404L20.0027 3.89277H21.0836L21.8672 5.07109L21.5159 6.28701L20.408 7.69096L19.4893 8.88181L18.172 10.6467L17.3545 12.0658L17.4278 12.1828L17.6248 12.166L20.5972 11.5267L22.205 11.2384L24.1235 10.9125L24.9882 11.3136L25.0828 11.7273L24.745 12.5672L22.6914 13.0686L20.2864 13.5575L16.7051 14.4005L16.6655 14.4324L16.7123 14.5018L18.3273 14.648L19.0164 14.6856H20.7053L23.8533 14.9238L24.6775 15.4628L25.1639 16.1272L25.0828 16.6411L23.8128 17.2804L22.1104 16.8793L18.1247 15.9266L16.7601 15.5882H16.5709V15.701L17.7058 16.8166L19.8 18.6969L22.4076 21.1288L22.5428 21.7304L22.205 22.2068L21.8537 22.1566L19.5568 20.4268L18.6651 19.6496L16.6655 17.9573H16.5304V18.1328L16.9897 18.8097L19.4352 22.4826L19.5568 23.6107L19.3812 23.9743L18.7462 24.1999L18.0571 24.0745L16.6114 22.0564L15.1387 19.8L13.9498 17.7693L13.8062 17.86L13.0986 25.4158L12.7743 25.8044L12.0177 26.0927L11.3827 25.6164L11.0449 24.8392L11.3827 23.2974L11.788 21.2917L12.1123 19.6997L12.4095 17.7192L12.5911 17.0575L12.575 17.0133L12.43 17.0376L10.9368 19.0855L8.66698 22.1566L6.87002 24.0745L6.43767 24.25L5.69457 23.8614L5.76212 23.172L6.18096 22.5578L8.66698 19.3989L10.1667 17.4309L11.1333 16.3012L11.1239 16.1378L11.0705 16.1332L4.46507 20.4393L3.28961 20.5897L2.7762 20.1134L2.84375 19.3362L3.08695 19.0855L5.07306 17.7192Z', { fill: '#D97757' })]],
  grok: ['svg', { viewBox: '0 0 24 24', fill: 'currentColor', 'fill-rule': 'evenodd' }, [path('M6.469 8.776L16.512 23h-4.464L2.005 8.776H6.47zm-.004 7.9l2.233 3.164L6.467 23H2l4.465-6.324zM22 2.582V23h-3.659V7.764L22 2.582zM22 1l-9.952 14.095-2.233-3.163L17.533 1H22z')]],
};

let sequence = 0;
export const hasIcon = (name: string): boolean => name in vectors;
export function icon(doc: Document, name: string): SVGElement {
  const suffix = `-glossa-${++sequence}`;
  const create = ([tag, attributes, children]: Vector): SVGElement => {
    const node = doc.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [key, value] of Object.entries(attributes)) {
      node.setAttribute(key, key === 'id' ? value + suffix : value.replace(/url\(#([^)]*)\)/g, `url(#$1${suffix})`));
    }
    children.forEach(child => node.append(create(child)));
    return node;
  };
  const svg = create(vectors[name] || vectors.file);
  svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false');
  svg.setAttribute('class', `glossa-icon glossa-icon-${name}`);
  return svg;
}
