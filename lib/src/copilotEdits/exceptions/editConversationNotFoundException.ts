class EditConversationNotFoundException extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EditConversationNotFoundException';
  }
}

export { EditConversationNotFoundException };
