/**
 * Puerto angosto que SÍ conoce SendMessageUseCase — sin `userId`, mismo
 * patrón que MemoryContextPort (quien lo inyecta ya lo pre-escopea a un
 * usuario). Ver UserScopedPersonalityContext para el adaptador genérico.
 */
export interface PersonalityContextPort {
  /** undefined si el usuario no configuró personalidad — el system prompt por defecto no cambia. */
  getPersonality(): Promise<string | undefined>;
}
