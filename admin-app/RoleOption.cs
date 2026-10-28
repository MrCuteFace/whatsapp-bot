namespace whatsapp_bot_user_management;

internal sealed record RoleOption(string Slug, string ClientType)
{
    public override string ToString() => ClientType;

    public static readonly RoleOption[] All =
    [
        new("shipping_agent", "סוכן אוניה"),
        new("forwarder", "משלח"),
        new("customs_broker", "עמיל מכס"),
    ];
}
