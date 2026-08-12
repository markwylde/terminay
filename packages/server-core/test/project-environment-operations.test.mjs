import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ProjectEnvironmentRepository, WorkspaceStore, createInitialWorkspace,
  createProjectEnvironmentOperationHandlers,
} from '../dist/index.js';

function fixture() {
  let persisted;
  const repository = new ProjectEnvironmentRepository({ async load() { return persisted; }, async commit(state) { persisted = structuredClone(state); } }, 'server-a');
  const workspace = new WorkspaceStore(createInitialWorkspace('server-a'));
  const events = [];
  const operations = createProjectEnvironmentOperationHandlers({ repository, workspace, thisServerRoot: () => '/home/server', onChanged: (event) => events.push(event) });
  const context = { connectionId:'connection-a', clientId:'client-a', authScope:'admin', permissions:['environments:read','environments:manage','workspace:write'], signal:new AbortController().signal };
  const query = (operation, payload={}, override={}) => operations.queries[operation]({ envelope:{type:'query',queryId:'q',operation,payload}, body:new Uint8Array(), context:{...context,...override} });
  const command = (operation, payload, commandId='command-a', override={}) => operations.commands[operation]({ envelope:{type:'command',commandId,correlationId:commandId,operation,payload}, body:new Uint8Array(), context:{...context,...override} });
  return { repository, workspace, events, query, command };
}

test('snapshot is bounded metadata and requires environments:read', async () => {
  const subject = fixture();
  const snapshot = await subject.query('projectEnvironments.snapshot');
  assert.equal(snapshot.revision, 0);
  assert.deepEqual(snapshot.providers, [{providerId:'terminay:this-server',displayName:'This server',capabilities:['terminal','filesystem']}]);
  assert.deepEqual(snapshot.environments, [{ id:'terminay:this-server', providerId:'terminay:this-server', providerLabel:'This Terminay Server', name:'This server', endpointSummary:'Local to this Terminay Server', status:'ready', referencedProjectCount:0, isThisServer:true }]);
  assert.equal(JSON.stringify(snapshot).includes('secretReferences'), false);
  await assert.rejects(() => subject.query('projectEnvironments.snapshot', {}, { permissions:[] }), /environments:read/);
});

test('snapshot exposes validated declarative provider contributions without executable code', async () => {
  const subject=fixture();
  const operations=createProjectEnvironmentOperationHandlers({repository:subject.repository,workspace:subject.workspace,thisServerRoot:()=>'/home/server',providerDefinitions:()=>[{providerId:'com.example.ssh/connection',displayName:'SSH',description:'Connect',capabilities:['terminal','filesystem'],profileForm:{id:'ssh-profile',title:'SSH profile',sections:[],submitLabel:'Save'}}]});
  const response=await operations.queries['projectEnvironments.snapshot']({envelope:{type:'query',queryId:'q',operation:'projectEnvironments.snapshot',payload:{}},body:new Uint8Array(),context:{connectionId:'c',clientId:'client-a',authScope:'admin',permissions:['environments:read'],signal:new AbortController().signal}});
  assert.deepEqual(response.providers[1],{providerId:'com.example.ssh/connection',displayName:'SSH',description:'Connect',capabilities:['terminal','filesystem'],profileForm:{id:'ssh-profile',title:'SSH profile',sections:[],submitLabel:'Save'}});
  assert.equal(JSON.stringify(response).includes('entrypoint'),false);
});

test('createProject validates This server root then commits one immutable workspace binding', async () => {
  const subject = fixture(); await subject.repository.load();
  const viewId = subject.workspace.state.viewOrder[0];
  const response = await subject.command('projectEnvironments.createProject', { environmentId:'terminay:this-server', viewId }, 'create-one');
  assert.equal(response.result.state, 'succeeded');
  const project = subject.workspace.state.projects[response.result.projectId];
  assert.equal(project.root, '/home/server');
  assert.equal(project.rootOrigin, 'environment-default');
  assert.equal(project.projectEnvironmentId, 'terminay:this-server');
  assert.equal(project.environmentRevision, 1);
  assert.deepEqual(subject.events, [{revision:0}]);
});

test('createProject never falls back for unknown or unavailable providers and permission denial is pre-mutation', async () => {
  const subject = fixture(); await subject.repository.load(); const viewId=subject.workspace.state.viewOrder[0]; const before=subject.workspace.state;
  await assert.rejects(() => subject.command('projectEnvironments.createProject', {environmentId:'ssh:missing',viewId}), /unavailable/);
  await assert.rejects(() => subject.command('projectEnvironments.createProject', {environmentId:'terminay:this-server',viewId}, 'denied', {permissions:['environments:read']}), /environments:manage/);
  assert.deepEqual(subject.workspace.state, before);
});

test('profile mutation uses one checked repository revision and publishes one change', async () => {
  const subject = fixture();
  const now = Date.now();
  const operations = createProjectEnvironmentOperationHandlers({ repository:subject.repository, workspace:subject.workspace, thisServerRoot:()=>'/home/server', onChanged:(event)=>subject.events.push(event), providers:{ async createProfile(providerId) { return { profile:{ id:'profile-a',providerId,name:'Example',endpointSummary:'example.test',activeRevision:1,recommendedRevision:1,revisions:{'1':{revision:1,createdAt:now,configuration:{host:'example.test'},secretReferences:['vault:key']}},archived:false } }; } } });
  await subject.repository.load();
  const request={envelope:{type:'command',commandId:'profile-command',correlationId:'profile-command',operation:'projectEnvironments.createProfile',payload:{providerId:'ssh:provider',values:{password:'never-return-this'}}},body:new Uint8Array(),context:{connectionId:'c',clientId:'client-a',authScope:'admin',permissions:['environments:manage'],signal:new AbortController().signal,expectedRevision:0}};
  const response=await operations.commands['projectEnvironments.createProfile'](request);
  assert.equal(response.revision,1);
  assert.equal(subject.repository.state.revision,1);
  assert.deepEqual(subject.events,[{revision:1}]);
  assert.equal(JSON.stringify(response).includes('never-return-this'),false);
  await assert.rejects(() => operations.commands['projectEnvironments.createProfile']({...request,envelope:{...request.envelope,commandId:'stale'},context:{...request.context,expectedRevision:0}}),/revision changed/);
});
