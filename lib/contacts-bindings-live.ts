import { browserContactStorage, CONTACT_STORAGE_KEY, type ContactDocument } from "./contact-storage";
import { browserBindingStorage, BINDING_STORAGE_KEY } from "./binding-storage";
import type { BindingDocument } from "./bindings";
import { createLiveDocument } from "./live-document";

export const liveContacts = createLiveDocument<ContactDocument>({
  initial: { version: 1, contacts: [] }, load: () => browserContactStorage.load(),
  key: CONTACT_STORAGE_KEY, event: "veil-contacts-change",
  error: "Contacts could not be loaded.", readyOnError: true,
});
export const liveBindings = createLiveDocument<BindingDocument>({
  initial: { global: {}, characters: {} }, load: () => browserBindingStorage.load(),
  key: BINDING_STORAGE_KEY, event: "veil-bindings-change", error: "Bindings could not be loaded.",
});
