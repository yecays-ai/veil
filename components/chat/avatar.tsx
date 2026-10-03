import type { ProfileBasics } from "../../lib/foundation-types";
export function ChatAvatar({
  profile,
}: {
  profile: Pick<ProfileBasics, "name" | "avatar">;
}) {
  return (
    <span className="chat-avatar" aria-hidden="true">
      {profile.avatar ? (
        // Uploaded avatars and remote URLs belong to the user's profile.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={profile.avatar} alt="" />
      ) : (
        profile.name.slice(0, 1)
      )}
    </span>
  );
}
