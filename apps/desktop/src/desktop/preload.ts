import { contextBridge, ipcRenderer } from 'electron';
import { CHANNELS, type EngineeringBridge } from '@follo/shared';

const bridge: EngineeringBridge = {
  getReadmeEvidence: (r, a) => ipcRenderer.invoke(CHANNELS.readmeEvidence, r, a),
  generateReadme: (r, a, e) => ipcRenderer.invoke(CHANNELS.readmeGenerate, r, a, e),
  getReadmeState: (id) => ipcRenderer.invoke(CHANNELS.readmeState, id),
  cancelReadme: (id) => ipcRenderer.invoke(CHANNELS.readmeCancel, id),
  saveReadmeDraft: (r, a, c) => ipcRenderer.invoke(CHANNELS.readmeSave, r, a, c),
  exportReadme: (content) => ipcRenderer.invoke(CHANNELS.readmeExport, content),
  getStatus: () => ipcRenderer.invoke(CHANNELS.status),
  getSettings: () => ipcRenderer.invoke(CHANNELS.getSettings),
  updateSettings: (settings) => ipcRenderer.invoke(CHANNELS.updateSettings, settings),
  openRepository: () => ipcRenderer.invoke(CHANNELS.openRepository),
  getRecentRepositories: () => ipcRenderer.invoke(CHANNELS.recentRepositories),
  reopenRepository: (id) => ipcRenderer.invoke(CHANNELS.reopenRepository, id),
  analyzeRepository: (id, options) => ipcRenderer.invoke(CHANNELS.analyzeRepository, id, options),
  getAnalysisState: (id) => ipcRenderer.invoke(CHANNELS.analysisState, id),
  getParsedFile: (repositoryId, fileId) =>
    ipcRenderer.invoke(CHANNELS.parsedFile, repositoryId, fileId),
  getGraph: (repositoryId, analysisId) =>
    ipcRenderer.invoke(CHANNELS.graph, repositoryId, analysisId),
  inspectFile: (repositoryId, analysisId, request) =>
    ipcRenderer.invoke(CHANNELS.inspectFile, repositoryId, analysisId, request),
  searchCode: (repositoryId, analysisId, request) =>
    ipcRenderer.invoke(CHANNELS.search, repositoryId, analysisId, request),
  searchConcept: (repositoryId, analysisId, query) =>
    ipcRenderer.invoke(CHANNELS.conceptSearch, repositoryId, analysisId, query),
  getConceptSearchState: (id) => ipcRenderer.invoke(CHANNELS.conceptSearchState, id),
  cancelConceptSearch: (id) => ipcRenderer.invoke(CHANNELS.cancelConceptSearch, id),
  getDecisionDefinitions: () => ipcRenderer.invoke(CHANNELS.decisionDefinitions),
  evaluateChangeRisk: (repositoryId, analysisId, fileId) =>
    ipcRenderer.invoke(CHANNELS.evaluateDecision, repositoryId, analysisId, fileId),
  getDecisionResults: (repositoryId, analysisId) =>
    ipcRenderer.invoke(CHANNELS.decisionResults, repositoryId, analysisId),
  getAiStatus: () => ipcRenderer.invoke(CHANNELS.aiStatus),
  configureLlm: (input) => ipcRenderer.invoke(CHANNELS.configureLlm, input),
  testLlmConnection: () => ipcRenderer.invoke(CHANNELS.testLlm),
  configureDecision: (input) => ipcRenderer.invoke(CHANNELS.configureDecision, input),
  testDecisionConnection: () => ipcRenderer.invoke(CHANNELS.testDecision),
  configureOpenRouter: (input) => ipcRenderer.invoke(CHANNELS.configureOpenRouter, input),
  getOpenRouterModels: () => ipcRenderer.invoke(CHANNELS.openRouterModels),
  getPrivacy: (repositoryId, analysisId) =>
    ipcRenderer.invoke(CHANNELS.privacy, repositoryId, analysisId),
  setPrivacy: (repositoryId, analysisId, policy) =>
    ipcRenderer.invoke(CHANNELS.setPrivacy, repositoryId, analysisId, policy),
  ask: (repositoryId, analysisId, question) =>
    ipcRenderer.invoke(CHANNELS.ask, repositoryId, analysisId, question),
  getAskState: (id) => ipcRenderer.invoke(CHANNELS.askState, id),
  cancelAsk: () => ipcRenderer.invoke(CHANNELS.cancelAsk),
  getRepositorySummary: (repositoryId) =>
    ipcRenderer.invoke(CHANNELS.repositorySummary, repositoryId),
  generateRepositorySummary: (repositoryId, analysisId) =>
    ipcRenderer.invoke(CHANNELS.generateSummary, repositoryId, analysisId),
  getRepositorySummaryState: (id) => ipcRenderer.invoke(CHANNELS.summaryState, id),
  cancelRepositorySummary: () => ipcRenderer.invoke(CHANNELS.cancelSummary),
  getFileSource: (repositoryId, analysisId, fileId) =>
    ipcRenderer.invoke(CHANNELS.fileSource, repositoryId, analysisId, fileId),
  explainCode: (repositoryId, analysisId, request) =>
    ipcRenderer.invoke(CHANNELS.explainCode, repositoryId, analysisId, request),
  getCodeExplanationState: (id) => ipcRenderer.invoke(CHANNELS.codeExplanationState, id),
  cancelCodeExplanation: (id) => ipcRenderer.invoke(CHANNELS.cancelCodeExplanation, id),
};
contextBridge.exposeInMainWorld('engineering', Object.freeze(bridge));
