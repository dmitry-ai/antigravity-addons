/**
 * folders-patch.js
 * Implements Method 1 from res/7.md: transforms Antigravity 2.0 client bundle (main.js)
 * to group projects under collapsible folder section headers in the left sidebar virtual list.
 */

const fs = require('fs');
const path = require('path');

const LOOP_ANCHOR = '(h?.isCollapsed?b.filter(v=>v.id==="standalone"):b).forEach(v=>{';
const LOOP_END = 'B&&q.push({type:"show-more",id:`show-more-${v.id}`,label:x?`See all (${v.items.length})`:"See less",groupId:v.id,isIndented:w})))}});';

/**
 * Applies folder grouping transformation to main.js source code.
 * @param {string} source - Original main.js source.
 * @param {object} foldersData - Parsed folders.json { folders: [], projectFolderMap: {} }.
 * @returns {string} Patched main.js source.
 */
function applyFolderPatch(source, foldersData) {
  if (!source || typeof source !== 'string') {
    return source;
  }

  const startIdx = source.indexOf(LOOP_ANCHOR);
  const endIdx = source.indexOf(LOOP_END);

  if (startIdx === -1 || endIdx === -1) {
    console.warn('[folders-patch] Critical loop anchors not found in main.js. Fallback to unpatched source.');
    return source;
  }

  // Extract original loop body for each item
  const originalLoopBody = source.slice(startIdx + LOOP_ANCHOR.length, endIdx + LOOP_END.length - 3);

  const serializedData = JSON.stringify(foldersData || { folders: [], projectFolderMap: {} });

  const replacement = `
var __renderItem=v=>{${originalLoopBody}};
var __allGroups=(h?.isCollapsed?b.filter(v=>v.id==="standalone"):b).filter(v=>v.id!=="cbe5c5cf-0878-4b4c-abe4-39d46e0b5b40"&&v.label!=="project-folders/folders");
var __fd=window.__PROJECT_FOLDERS_DATA__||${serializedData};
if(c==="project"&&__fd&&Array.isArray(__fd.folders)&&__fd.folders.length>0){
  var __fldMap=__fd.projectFolderMap||{};
  var __projGroups=__allGroups.filter(v=>v.id!=="standalone");
  var __standalone=__allGroups.find(v=>v.id==="standalone");
  var __rendered=new Set();
  for(var __fi=0;__fi<__fd.folders.length;__fi++){
    var __f=__fd.folders[__fi];
    var __inF=__projGroups.filter(v=>__fldMap[v.id]===__f.id);
    if(__inF.length>0){
      var __isCol=t("folder-"+__f.id);
      q.push({
        type:"section-header",
        id:"section-folder-"+__f.id,
        title:"📁 "+__f.name+" ("+__inF.length+")",
        isCollapsible:!0,
        isCollapsed:__isCol,
        collapseId:"folder-"+__f.id
      });
      for(var __pi=0;__pi<__inF.length;__pi++){
        __rendered.add(__inF[__pi].id);
        if(!__isCol){
          __renderItem(__inF[__pi]);
        }
      }
    }
  }
  for(var __pi=0;__pi<__projGroups.length;__pi++){
    if(!__rendered.has(__projGroups[__pi].id)){
      __renderItem(__projGroups[__pi]);
    }
  }
  if(__standalone){
    __renderItem(__standalone);
  }
}else{
  __allGroups.forEach(__renderItem);
}
`;

  const headerPrefix = `window.__PROJECT_FOLDERS_DATA__ = ${serializedData};\n`;
  const patched = headerPrefix + source.slice(0, startIdx) + replacement + source.slice(endIdx + LOOP_END.length);

  return patched;
}

module.exports = {
  applyFolderPatch,
  LOOP_ANCHOR,
  LOOP_END
};
