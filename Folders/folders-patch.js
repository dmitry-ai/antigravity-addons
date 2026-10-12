/**
 * folders-patch.js
 * Implements Method 1 from res/16.md: Parent References tree model with DFS traversal.
 * Transforms Antigravity 2.0 client bundle (main.js)
 * to group projects under hierarchical collapsible folder section headers in the left sidebar virtual list,
 * support arbitrary nesting depths via parentId, prevent hidden projects leaking on collapse,
 * subscribe React to configuration changes,
 * and bundle the interactive Folders client controller.
 */

const fs = require('fs');
const path = require('path');

const LOOP_ANCHOR = '(h?.isCollapsed?b.filter(v=>v.id==="standalone"):b).forEach(v=>{';
const LOOP_END = 'B&&q.push({type:"show-more",id:`show-more-${v.id}`,label:x?`See all (${v.items.length})`:"See less",groupId:v.id,isIndented:w})))}});';
const HR_ANCHOR = 'function hR(a,b,c,e){var {core:f}=Lc(),g=f.storageService,'; // retained for source compatibility
const ROW_HOOK_ANCHOR = 'includePinnedSection:v=!1}){var w=YIb()';
const ROW_MEMO_ANCHOR = '[ba,b,h,m,X,k,l,n,E,D,v,w]';
const SECTION_OUTER_ANCHOR = 'A.createElement("div",{"data-testid":"section-header","data-title":T.title,"data-collapsed":!!T.isCollapsed},A.createElement(CRb,{title:T.title,headerActions:T.headerActions,surface:c,';
const HEADER_PROPS_ANCHOR = 'isActionMenuOpen:m=!1,"data-testid":n})=>{var p=WI();';
const HEADER_DOM_ANCHOR = 'return A.createElement("div",{"data-testid":n,className:Xi("group/section-header';
const PROJECT_DOM_ANCHOR = '"data-project-card":!0,"aria-expanded":!a.isCollapsed';
const EMPTY_PLACEHOLDER_ANCHOR = 'T.type==="empty-placeholder"?A.createElement("span",{className:Xi("pr-2.5 select-none text-sm opacity-30 h-8 flex items-center justify-start",T.isIndented?"pl-[30px]":"pl-2")},T.label)';

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

  const requiredAnchors = [
    LOOP_ANCHOR,
    LOOP_END,
    ROW_HOOK_ANCHOR,
    ROW_MEMO_ANCHOR,
    SECTION_OUTER_ANCHOR,
    HEADER_PROPS_ANCHOR,
    HEADER_DOM_ANCHOR,
    PROJECT_DOM_ANCHOR,
    EMPTY_PLACEHOLDER_ANCHOR
  ];
  if (startIdx === -1 || endIdx <= startIdx || requiredAnchors.some(anchor => source.split(anchor).length !== 2)) {
    console.warn('[folders-patch] Critical loop anchors not found in main.js. Fallback to unpatched source.');
    return source;
  }

  // Extract original loop body for each item
  const originalLoopBody = source.slice(startIdx + LOOP_ANCHOR.length, endIdx + LOOP_END.length - 3);

  const serializedData = JSON.stringify(foldersData || { folders: [], projectFolderMap: {} });

  const replacement = `
var __renderItem=function(v,__fId,__depth){
  var __startLen=q.length;
  ${originalLoopBody};
  if(__depth!==void 0){
    for(var __qi=__startLen;__qi<q.length;__qi++){
      if(q[__qi]){
        if(__fId!==void 0&&__fId!==null)q[__qi].folderId=__fId;
        q[__qi].folderDepth=__depth;
      }
    }
  }
};
var __allGroups=(h?.isCollapsed?b.filter(v=>v.id==="standalone"):b).filter(v=>v.id!=="cbe5c5cf-0878-4b4c-abe4-39d46e0b5b40"&&v.label!=="project-folders/folders");
if(typeof window!=="undefined"){
  window.__PROJECT_FOLDERS_CONVO_MAP__=window.__PROJECT_FOLDERS_CONVO_MAP__||{};
  for(var __cgi=0;__cgi<__allGroups.length;__cgi++){
    var __cg=__allGroups[__cgi];
    if(__cg&&__cg.id&&Array.isArray(__cg.items)){
      for(var __cii=0;__cii<__cg.items.length;__cii++){
        var __citem=__cg.items[__cii];
        if(__citem&&__citem.cascadeId){
          window.__PROJECT_FOLDERS_CONVO_MAP__[__citem.cascadeId]=__cg.id;
        }
      }
    }
  }
}
var __fd=window.__PROJECT_FOLDERS_DATA__||${serializedData};
if(c==="project"&&l==="sidebar"&&!h?.isCollapsed&&__fd&&Array.isArray(__fd.folders)&&__fd.folders.length>0){
  var __fldMap=__fd.projectFolderMap||{};
  var __projGroups=__allGroups.filter(v=>v.id!=="standalone");
  var __standalone=__allGroups.find(v=>v.id==="standalone");

  var __childrenMap={};
  var __validFolderIds=new Set();
  for(var __i=0;__i<__fd.folders.length;__i++){
    var __f=__fd.folders[__i];
    __validFolderIds.add(__f.id);
    var __pId=__f.parentId||"__root__";
    if(!__childrenMap[__pId])__childrenMap[__pId]=[];
    __childrenMap[__pId].push(__f);
  }

  var __folderSorter=function(a,b){
    var cmp=(a?.name||"").localeCompare(b?.name||"",undefined,{numeric:!0,sensitivity:"base"});
    return cmp!==0?cmp:(a?.id||"").localeCompare(b?.id||"");
  };
  for(var __k in __childrenMap){
    __childrenMap[__k].sort(__folderSorter);
  }

  var __renderFolderBranch=function(__parentKey,__depth){
    var __levelFolders=__childrenMap[__parentKey]||[];
    for(var __fi=0;__fi<__levelFolders.length;__fi++){
      var __f=__levelFolders[__fi];
      var __inF=__projGroups.filter(function(v){return __fldMap[v.id]===__f.id;});
      var __subFolders=__childrenMap[__f.id]||[];
      var __isCol=t("folder-"+__f.id);
      q.push({
        type:"section-header",
        id:"section-folder-"+__f.id,
        title:"📁 "+__f.name,
        isCollapsible:!0,
        isCollapsed:__isCol,
        collapseId:"folder-"+__f.id,
        folderId:__f.id,
        folderName:__f.name,
        folderDepth:__depth,
        itemCount:__inF.length
      });
      if(!__isCol){
        for(var __pi=0;__pi<__inF.length;__pi++){
          __renderItem(__inF[__pi],__f.id,__depth+1);
        }
        __renderFolderBranch(__f.id,__depth+1);
        if(__inF.length===0&&__subFolders.length===0){
          q.push({
            type:"empty-placeholder",
            id:"empty-folder-"+__f.id,
            groupId:"folder-"+__f.id,
            folderId:__f.id,
            label:"(папка пуста)",
            isIndented:!0,
            folderDepth:__depth+1
          });
        }
      }
    }
  };

  __renderFolderBranch("__root__",0);

  for(var __pi=0;__pi<__projGroups.length;__pi++){
    var __assignedFid=__fldMap[__projGroups[__pi].id];
    if(!__assignedFid||!__validFolderIds.has(__assignedFid)){
      __renderItem(__projGroups[__pi],null,0);
    }
  }

  if(__standalone){
    __renderItem(__standalone,null,0);
  }
}else{
  __allGroups.forEach(function(v){__renderItem(v,null,0);});
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
  patched = patched.replace(ROW_HOOK_ANCHOR,
    'includePinnedSection:v=!1}){var [__folderRevision,__setFolderRevision]=(0,A.useState)(0);(0,A.useEffect)(()=>{var __listener=()=>__setFolderRevision(__v=>__v+1);window.addEventListener("antigravity-folders-updated",__listener);return()=>window.removeEventListener("antigravity-folders-updated",__listener)},[]);var w=YIb()');
  patched = patched.replace(ROW_MEMO_ANCHOR, '[ba,b,h,m,X,k,l,n,E,D,v,w,__folderRevision]');

  // Inject folderId and folderDepth into outer div and inner CRb component
  patched = patched.replace(SECTION_OUTER_ANCHOR,
    'A.createElement("div",{"data-testid":"section-header","data-title":T.title,"data-folder-id":T.folderId,"data-folder-depth":T.folderDepth,"data-collapsed":!!T.isCollapsed},A.createElement(CRb,{title:T.title,headerActions:T.headerActions,surface:c,folderId:T.folderId,folderDepth:T.folderDepth,');

  patched = patched.replace(HEADER_PROPS_ANCHOR,
    'isActionMenuOpen:m=!1,"data-testid":n,folderId:__folderId,folderDepth:__folderDepth})=>{var p=WI();');
  patched = patched.replace(HEADER_DOM_ANCHOR,
    'return A.createElement("div",{"data-testid":n,"data-title":a,"data-folder-id":__folderId,"data-folder-depth":__folderDepth,className:Xi("group/section-header');
  patched = patched.replace(PROJECT_DOM_ANCHOR,
    '"data-project-card":!0,"data-project-id":c,"data-folder-id":a?.folderId,"data-folder-depth":a?.folderDepth,"aria-expanded":!a.isCollapsed');
  patched = patched.replace(EMPTY_PLACEHOLDER_ANCHOR,
    'T.type==="empty-placeholder"?A.createElement("span",{"data-testid":"empty-placeholder","data-folder-id":T.folderId,"data-folder-depth":T.folderDepth,className:Xi("pr-2.5 select-none text-sm opacity-30 h-8 flex items-center justify-start",T.isIndented?"pl-[30px]":"pl-2")},T.label)');

  const VIRTUAL_ROW_STYLE_ANCHOR = '{key:T.id,"data-index":R.index,ref:ba,style:da,';
  const VIRTUAL_ROW_ANCHOR = '{key:T.id,"data-index":R.index,';
  if (patched.includes(VIRTUAL_ROW_STYLE_ANCHOR)) {
    patched = patched.replace(VIRTUAL_ROW_STYLE_ANCHOR,
      '{key:T.id,"data-index":R.index,"data-group-id":T.groupId,"data-folder-id":T.folderId,"data-folder-depth":T.folderDepth,ref:ba,style:(T.folderDepth!=null?{...da,"--folder-depth":T.folderDepth}:da),');
  } else if (patched.includes(VIRTUAL_ROW_ANCHOR)) {
    patched = patched.replace(VIRTUAL_ROW_ANCHOR,
      '{key:T.id,"data-index":R.index,"data-group-id":T.groupId,"data-folder-id":T.folderId,"data-folder-depth":T.folderDepth,');
  }

  // Verify compiled syntax
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
  HR_ANCHOR,
  ROW_HOOK_ANCHOR,
  ROW_MEMO_ANCHOR,
  SECTION_OUTER_ANCHOR,
  HEADER_PROPS_ANCHOR,
  HEADER_DOM_ANCHOR,
  PROJECT_DOM_ANCHOR,
  EMPTY_PLACEHOLDER_ANCHOR
};
