/**
 * folders-patch.js
 * Implements Method 1 & 2 from res/13.md: transforms Antigravity 2.0 client bundle (main.js)
 * to group projects under collapsible folder section headers in the left sidebar virtual list,
 * support empty folders, subscribe React to configuration changes,
 * and bundle the interactive Folders client controller (drag-drop, inline rename, context menus).
 */

const fs = require('fs');
const path = require('path');

const LOOP_ANCHOR = '(h?.isCollapsed?b.filter(v=>v.id==="standalone"):b).forEach(v=>{';
const LOOP_END = 'B&&q.push({type:"show-more",id:`show-more-${v.id}`,label:x?`See all (${v.items.length})`:"See less",groupId:v.id,isIndented:w})))}});';
const HR_ANCHOR = 'function hR(a,b,c,e){var {core:f}=Lc(),g=f.storageService,'; // retained for source compatibility
const ROW_HOOK_ANCHOR = 'includePinnedSection:v=!1}){var w=YIb()';
const ROW_MEMO_ANCHOR = '[ba,b,h,m,X,k,l,n,E,D,v,w]';
const HEADER_PROPS_ANCHOR = 'isActionMenuOpen:m=!1,"data-testid":n})=>{var p=WI();';
const HEADER_DOM_ANCHOR = 'return A.createElement("div",{"data-testid":n,className:Xi("group/section-header';
const PROJECT_DOM_ANCHOR = '"data-project-card":!0,"aria-expanded":!a.isCollapsed';


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

  const requiredAnchors = [LOOP_ANCHOR, LOOP_END, ROW_HOOK_ANCHOR, ROW_MEMO_ANCHOR, HEADER_PROPS_ANCHOR, HEADER_DOM_ANCHOR, PROJECT_DOM_ANCHOR];
  if (startIdx === -1 || endIdx <= startIdx || requiredAnchors.some(anchor => source.split(anchor).length !== 2)) {
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
if(c==="project"&&l==="sidebar"&&!h?.isCollapsed&&__fd&&Array.isArray(__fd.folders)&&__fd.folders.length>0){
  var __fldMap=__fd.projectFolderMap||{};
  var __projGroups=__allGroups.filter(v=>v.id!=="standalone");
  var __standalone=__allGroups.find(v=>v.id==="standalone");
  var __rendered=new Set();
  for(var __fi=0;__fi<__fd.folders.length;__fi++){
    var __f=__fd.folders[__fi];
    var __inF=__projGroups.filter(v=>__fldMap[v.id]===__f.id);
    var __isCol=t("folder-"+__f.id);
    q.push({
      type:"section-header",
      id:"section-folder-"+__f.id,
      title:"📁 "+__f.name+" ("+__inF.length+")",
      isCollapsible:!0,
      isCollapsed:__isCol,
      collapseId:"folder-"+__f.id,
      folderId:__f.id,
      folderName:__f.name,
      itemCount:__inF.length
    });
    for(var __pi=0;__pi<__inF.length;__pi++){
      __rendered.add(__inF[__pi].id);
      if(!__isCol){
        __renderItem(__inF[__pi]);
      }
    }
    if(!__isCol&&__inF.length===0){
      q.push({
        type:"empty-placeholder",
        id:"empty-folder-"+__f.id,
        groupId:"folder-"+__f.id,
        label:"(папка пуста)",
        isIndented:!0
      });
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

  // Read client script
  let clientScript = '';
  const clientScriptPath = path.join(__dirname, 'folders-client.js');
  try {
    if (fs.existsSync(clientScriptPath)) {
      clientScript = fs.readFileSync(clientScriptPath, 'utf8');
    }
  } catch (e) {
    console.warn('[folders-patch] Could not read folders-client.js:', e);
  }

  const headerPrefix = `window.__PROJECT_FOLDERS_DATA__ = ${serializedData};\n${clientScript}\n`;
  let patched = headerPrefix + source.slice(0, startIdx) + replacement + source.slice(endIdx + LOOP_END.length);

  // Subscribe inside the shared row hook and include the revision in its memo.
  // Re-storing an unchanged value in Antigravity's own storage does not notify React.
  patched = patched.replace(ROW_HOOK_ANCHOR,
    'includePinnedSection:v=!1}){var [__folderRevision,__setFolderRevision]=(0,A.useState)(0);(0,A.useEffect)(()=>{var __listener=()=>__setFolderRevision(__v=>__v+1);window.addEventListener("antigravity-folders-updated",__listener);return()=>window.removeEventListener("antigravity-folders-updated",__listener)},[]);var w=YIb()');
  patched = patched.replace(ROW_MEMO_ANCHOR, '[ba,b,h,m,X,k,l,n,E,D,v,w,__folderRevision]');
  // Publish stable IDs and titles on real DOM nodes; the controller never resolves by display name.
  patched = patched.replace(HEADER_PROPS_ANCHOR,
    'isActionMenuOpen:m=!1,"data-testid":n,folderId:__folderId})=>{var p=WI();');
  patched = patched.replace(HEADER_DOM_ANCHOR,
    'return A.createElement("div",{"data-testid":n,"data-title":a,"data-folder-id":__folderId,className:Xi("group/section-header');
  patched = patched.replace(PROJECT_DOM_ANCHOR,
    '"data-project-card":!0,"data-project-id":c,"aria-expanded":!a.isCollapsed');
  // A malformed transformation must not be served as the application's main script.
  try { new (require('vm').Script)(patched); } catch (error) {
    console.error('[folders-patch] Invalid transformed JavaScript; returning original bundle:', error.message);
    return source;
  }

  return patched;
}

module.exports = {
  applyFolderPatch,
  LOOP_ANCHOR,
  LOOP_END,
  HR_ANCHOR, ROW_HOOK_ANCHOR, ROW_MEMO_ANCHOR, HEADER_PROPS_ANCHOR, HEADER_DOM_ANCHOR, PROJECT_DOM_ANCHOR
};
