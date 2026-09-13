import type { PhysicalResource } from '../game-state';

export interface ResourceHub {
  readonly id: string;
  readonly resource: PhysicalResource;
  readonly centerProvinceId: number;
  readonly amount: number;
  readonly concentration: number;
}

type Profile = 'world' | 'major' | 'regional' | 'belt';
const PROFILE: Record<Profile, readonly [number, number]> = {
  world: [100, 0.85], major: [75, 0.60], regional: [50, 0.75], belt: [70, 0.20],
};
const hub = (resource: PhysicalResource, id: string, centerProvinceId: number, profile: Profile): ResourceHub => ({
  id, resource, centerProvinceId,
  amount: PROFILE[profile][0], concentration: PROFILE[profile][1],
});

/** Designer-authored physical potential anchors. Province ids are geography only. */
export const RESOURCE_HUBS: readonly ResourceHub[] = [
  // Oil and gas basins.
  hub('oil', 'persian-gulf', 2000, 'world'), hub('oil', 'mesopotamia', 2056, 'world'),
  hub('oil', 'caspian', 2082, 'world'), hub('oil', 'west-siberia', 3067, 'world'),
  hub('oil', 'volga-urals', 3066, 'world'), hub('oil', 'romanian', 338, 'world'),
  hub('oil', 'texas-gulf', 638, 'world'), hub('oil', 'oklahoma', 322, 'world'),
  hub('oil', 'california', 504, 'world'), hub('oil', 'alberta', 700, 'world'),
  hub('oil', 'maracaibo', 1017, 'world'), hub('oil', 'orinoco', 1022, 'major'),
  hub('oil', 'mexico-gulf', 604, 'world'), hub('oil', 'north-sea', 239, 'major'),
  hub('oil', 'libya', 1531, 'world'), hub('oil', 'sahara', 1594, 'major'),
  hub('oil', 'niger-delta', 1853, 'world'), hub('oil', 'sumatra-java', 2372, 'world'),
  hub('oil', 'borneo-brunei', 2642, 'world'), hub('oil', 'assam', 2241, 'world'),
  hub('oil', 'northeast-china', 3039, 'world'),
  hub('oil', 'eastern-arabia', 2007, 'world'), hub('oil', 'west-siberia-north', 3068, 'world'),
  hub('oil', 'texas-permian', 640, 'world'), hub('oil', 'alberta-athabasca', 702, 'world'),
  hub('oil', 'orinoco-east', 1024, 'world'), hub('oil', 'libya-sirte', 1533, 'world'),

  // Aggregated economically useful ore belts.
  hub('metal', 'kiruna', 22, 'world'), hub('metal', 'lorraine', 267, 'major'),
  hub('metal', 'ukraine', 107, 'world'), hub('metal', 'urals', 3066, 'world'),
  hub('metal', 'mesabi', 469, 'world'), hub('metal', 'canadian-shield', 743, 'belt'),
  hub('metal', 'minas-gerais', 1288, 'world'), hub('metal', 'andes-chile', 1371, 'major'),
  hub('metal', 'andes-peru', 997, 'world'), hub('metal', 'guiana', 1043, 'regional'),
  hub('metal', 'transvaal', 1412, 'world'), hub('metal', 'copperbelt', 1168, 'world'),
  hub('metal', 'pilbara', 2689, 'world'), hub('metal', 'broken-hill', 1386, 'world'),
  hub('metal', 'odisha', 2241, 'world'), hub('metal', 'north-china', 2328, 'major'),
  hub('metal', 'manchuria', 3039, 'world'),
  hub('metal', 'labrador', 805, 'world'), hub('metal', 'north-urals', 3070, 'world'),
  hub('metal', 'donbas', 105, 'world'), hub('metal', 'andean-altiplano', 1370, 'world'),
  hub('metal', 'australian-interior', 2722, 'world'), hub('metal', 'eastern-india', 2160, 'world'),
  hub('metal', 'manchuria-north', 3045, 'world'), hub('metal', 'great-lakes-east', 471, 'world'),

  // Agricultural land-quality regions, deliberately broad.
  hub('food', 'great-plains', 586, 'world'), hub('food', 'corn-belt', 562, 'regional'),
  hub('food', 'california-valley', 504, 'major'), hub('food', 'pampas', 1158, 'world'),
  hub('food', 'western-europe', 267, 'major'), hub('food', 'central-europe', 116, 'regional'),
  hub('food', 'po-valley', 250, 'regional'), hub('food', 'ukraine-black-earth', 93, 'world'),
  hub('food', 'nile', 1395, 'major'), hub('food', 'punjab', 2133, 'world'),
  hub('food', 'indo-gangetic', 2146, 'major'), hub('food', 'north-china-plain', 2328, 'regional'),
  hub('food', 'yangtze', 2321, 'regional'), hub('food', 'mekong', 2372, 'regional'),
  hub('food', 'chao-phraya', 2361, 'regional'), hub('food', 'java', 2642, 'major'),
  hub('food', 'murray-darling', 2722, 'major'), hub('food', 'canadian-prairies', 743, 'regional'),
  hub('food', 'mississippi', 591, 'regional'),

  // Broad quarryable geology; stone is intentionally diffuse.
  hub('stone', 'scandinavian-shield', 28, 'world'), hub('stone', 'alps', 250, 'world'),
  hub('stone', 'carpathians', 338, 'regional'), hub('stone', 'caucasus', 2082, 'world'),
  hub('stone', 'urals-stone', 3066, 'world'), hub('stone', 'appalachia', 591, 'world'),
  hub('stone', 'canadian-shield-stone', 743, 'major'), hub('stone', 'rockies', 692, 'world'),
  hub('stone', 'andes-stone', 997, 'world'), hub('stone', 'brazilian-highlands', 1288, 'regional'),
  hub('stone', 'atlas', 1594, 'regional'), hub('stone', 'ethiopian-highlands', 1395, 'regional'),
  hub('stone', 'southern-africa', 1413, 'world'), hub('stone', 'east-african-rift', 1168, 'regional'),
  hub('stone', 'himalaya', 2133, 'world'), hub('stone', 'deccan', 2146, 'regional'),
  hub('stone', 'china-mountains', 2328, 'world'), hub('stone', 'australian-craton', 2689, 'world'),
];
