class EditTurnNotFoundException extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EditTurnNotFoundException';
  }
}

export { EditTurnNotFoundException };
