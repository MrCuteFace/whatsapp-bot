namespace whatsapp_bot_user_management;

internal static class DbConfig
{
    /// <summary>
    /// Read from the environment rather than compiled in: a connection string in the binary ships to
    /// every machine the app is installed on, and anyone with a decompiler can read it back.
    /// Prefer Windows authentication, so each admin connects with their own SQL permissions, e.g.
    /// "Server=sql01;Database=BotDb;Integrated Security=True;TrustServerCertificate=True;".
    /// </summary>
    public static string ConnectionString =>
        Environment.GetEnvironmentVariable("BOT_DB_CONNECTION")
        ?? throw new InvalidOperationException(
            "Set BOT_DB_CONNECTION to the bot database's connection string before starting the app.");
}
