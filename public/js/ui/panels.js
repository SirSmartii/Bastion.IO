// Die großen Fenster nach Name. Jedes bietet layout(), draw() und onClick(x, y).

import * as forge from './forge.js';
import * as craft from './craft.js';
import * as build from './build.js';
import * as skills from './skills.js';
import * as team from './team.js';
import * as map from './map.js';
import * as esc from './esc.js';
import * as admin from './admin.js';

export const panels = { forge, craft, build, skills, team, map, esc, admin };
