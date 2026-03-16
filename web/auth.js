import passport from "passport";
import { Strategy as GitHubStrategy } from "passport-github2";
import config from "./config.js";

passport.serializeUser((user, done) => {
  done(null, user);
});

passport.deserializeUser((user, done) => {
  done(null, user);
});

if (config.github.clientId && config.github.clientSecret) {
  passport.use(
    new GitHubStrategy(
      {
        clientID: config.github.clientId,
        clientSecret: config.github.clientSecret,
        callbackURL: `${config.baseUrl}/auth/github/callback`,
      },
      (accessToken, refreshToken, profile, done) => {
        const user = {
          id: profile.id,
          username: profile.username,
          displayName: profile.displayName || profile.username,
          avatar: profile.photos?.[0]?.value || "",
          isAdmin: config.adminUsers.includes(
            profile.username.toLowerCase(),
          ),
        };
        done(null, user);
      },
    ),
  );
}

export default passport;
