const ErrorCode = {
  ParseError: -32700,
  InvalidRequest: -32600,
  MethodNotFound: -32601,
  InvalidParams: -32602,
  InternalError: -32603,
  ServerNotInitialized: -32002,
  RequestCancelled: -32800,
  ContentModified: -32801,
  ServerCancelled: -32802,
  NoCopilotToken: 1000,
  DeviceFlowFailed: 1001,
  CopilotNotAvailable: 1002,
};

export { ErrorCode };
